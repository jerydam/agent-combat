'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Address } from 'viem';
import { ensureChain, getWalletClient } from './chain';
import { api } from './api';

interface WalletContextValue {
  address: Address | '';
  connected: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<`0x${string}`>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | ''>('');
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    const client = getWalletClient();
    if (!client) {
      alert('No wallet found — install MetaMask or another injected wallet.');
      return;
    }
    setConnecting(true);
    try {
      await ensureChain();
      const [addr] = await client.requestAddresses();
      setAddress(addr);
      api.upsertUser(addr).catch(() => {});
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(''), []);

  const signMessage = useCallback(
    async (message: string) => {
      const client = getWalletClient();
      if (!client || !address) throw new Error('Wallet not connected');
      return client.signMessage({ account: address as Address, message });
    },
    [address],
  );

  // Follow account changes in the wallet
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accts: string[]) =>
      setAddress((accts[0] as Address) ?? '');
    eth.on('accountsChanged', onAccounts);
    return () => eth.removeListener?.('accountsChanged', onAccounts);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        connected: !!address,
        connecting,
        connect,
        disconnect,
        signMessage,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export function shortAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}
