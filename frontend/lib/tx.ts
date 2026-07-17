'use client';

import type { Abi, Address } from 'viem';
import { decodeEventLog } from 'viem';
import { getWalletClient, getPublicClient, ensureChain } from './chain';

/** Send a contract write and wait for the receipt. */
export async function writeContract(params: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account: Address;
}) {
  const client = getWalletClient();
  if (!client) throw new Error('Wallet not connected');
  await ensureChain();
  const publicClient = getPublicClient();
  const { request } = await publicClient.simulateContract({
    ...params,
    account: params.account,
  } as any);
  const hash = await client.writeContract({
    ...request,
    account: params.account,
  } as any);
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
