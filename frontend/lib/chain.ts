import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
} from 'viem';
import { getSigningAccount } from './embedded-wallet';

export const botchain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 677),
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] },
  },
  blockExplorers: {
    default: { name: 'BotScan', url: 'https://scan.botchain.ai' },
  },
});

let _publicClient: ReturnType<typeof createPublicClient> | null = null;

/** Lazy — never constructed at module scope so builds don't need env vars. */
export function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: botchain,
      transport: http(
        process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545',
      ),
    });
  }
  return _publicClient;
}

/**
 * Wallet client for whichever wallet is active.
 *
 * Embedded (social-login) wallets hold a local key, so they talk to the
 * chain over plain HTTP and sign in-process. External wallets proxy through
 * the injected provider. Callers don't need to care which — but they DO
 * need to pass `getSigningAccount() ?? address` as `account`, because a
 * local account must be handed to viem as an object, not an address.
 */
export function getWalletClient() {
  const local = getSigningAccount();
  if (local) {
    return createWalletClient({
      account: local,
      chain: botchain,
      transport: http(process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545'),
    });
  }
  if (typeof window === 'undefined' || !(window as any).ethereum) return null;
  return createWalletClient({
    chain: botchain,
    transport: custom((window as any).ethereum),
  });
}

/** Prompt the wallet to add/switch to BOT Chain. */
export async function ensureChain(): Promise<void> {
  // Embedded wallets are pinned to botchain by construction — there is no
  // provider to switch, and calling into an unrelated injected wallet here
  // would pop MetaMask at a player who deliberately chose Google sign-in.
  if (getSigningAccount()) return;
  const eth = (window as any).ethereum;
  if (!eth) return;
  const hex = `0x${botchain.id.toString(16)}`;
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: hex,
            chainName: botchain.name,
            nativeCurrency: botchain.nativeCurrency,
            rpcUrls: botchain.rpcUrls.default.http,
            blockExplorerUrls: [botchain.blockExplorers.default.url],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}
