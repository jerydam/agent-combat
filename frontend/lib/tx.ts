'use client';

import type { Abi, Address } from 'viem';
import { decodeEventLog } from 'viem';
import { getWalletClient, getPublicClient, ensureChain } from './chain';
import { getSigningAccount, loadSession, WalletLockedError } from './embedded-wallet';

/**
 * Ask the app shell to open the PIN sheet.
 *
 * A window event rather than a callback registry: `writeContract` is called
 * from a dozen places that have no idea the wallet might be embedded, and
 * threading an "onLocked" handler through all of them would be noise.
 */
function requestUnlock(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agent-arena:wallet-locked'));
  }
}

/** Send a contract write and wait for the receipt. */
export async function writeContract(params: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account: Address;
}) {
  // A signed-in embedded wallet with no key in memory can't sign anything.
  // Catch it here and ask for the PIN, instead of falling through to the
  // injected-provider path and failing with a misleading
  // "Wallet not connected" at a player who is very much connected.
  const local = getSigningAccount();
  if (!local && loadSession()) {
    requestUnlock();
    throw new WalletLockedError();
  }

  const client = getWalletClient();
  if (!client) throw new Error('Wallet not connected');
  await ensureChain();

  // An embedded wallet signs in-process, so viem needs the Account OBJECT,
  // not just an address — passing the address alone would make it try to
  // delegate signing to a provider that isn't there.
  if (local && local.address.toLowerCase() !== params.account.toLowerCase()) {
    requestUnlock();
    throw new WalletLockedError();
  }
  const account: any = local ?? params.account;

  const publicClient = getPublicClient();
  const { request } = await publicClient.simulateContract({
    ...params,
    account,
  } as any);
  const hash = await client.writeContract({ ...request, account } as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt;
}

/** Pull one decoded event's args out of a receipt. */
export function eventArgs<T = any>(
  receipt: { logs: any[] },
  abi: Abi,
  eventName: string,
): T | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === eventName) return decoded.args as T;
    } catch {
      /* other contract's log */
    }
  }
  return null;
}
