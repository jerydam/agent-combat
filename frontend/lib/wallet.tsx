'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Address } from 'viem';
import { botchain, ensureChain, getWalletClient } from './chain';
import { api } from './api';
import {
  clearSession, getSigningAccount, isUnlocked, loadSession, lock as lockKey,
  openAuthPopup, saveSession, socialLogin, unlockWithPin, walletApi,
  type SocialProvider, type WalletSession,
} from './embedded-wallet';

export type WalletMode = 'none' | 'embedded' | 'external';

interface WalletContextValue {
  address: Address | '';
  connected: boolean;
  connecting: boolean;
  /** how this player is signed in */
  mode: WalletMode;
  /** embedded only: is the signing key currently in memory? */
  unlocked: boolean;
  /** embedded only: has the player set a 6-digit PIN yet? */
  hasPin: boolean;
  session: WalletSession | null;

  connect: () => Promise<void>;              // external wallet
  connectSocial: (p: SocialProvider) => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<`0x${string}`>;

  /** Unlock the embedded key. Resolves true if the wallet can now sign. */
  unlock: (pin: string) => Promise<void>;
  lock: () => void;
  setPin: (pin: string, currentPin?: string) => Promise<void>;
  refreshAccount: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | ''>('');
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<WalletMode>('none');
  const [session, setSession] = useState<WalletSession | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // Restore an embedded session on load. The JWT lasts 30 days, so a player
  // who signed in with Google yesterday is still signed in — they only have
  // to re-enter their PIN, because the key itself is memory-only by design.
  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setSession(s);
    setAddress(s.address as Address);
    setMode('embedded');
    setUnlocked(isUnlocked());
    walletApi.me(s.token)
      .then((me) => setHasPin(me.has_pin))
      .catch(() => { /* token expired — handled on first authed call */ });
    api.upsertUser(s.address).catch(() => {});
  }, []);

  const refreshAccount = useCallback(async () => {
    const s = loadSession();
    if (!s) return;
    const me = await walletApi.me(s.token);
    setHasPin(me.has_pin);
    setSession({ ...s, linked_socials: me.linked_socials });
    saveSession({ ...s, linked_socials: me.linked_socials });
  }, []);

  // ---------------------------------------------------------- external
  const connect = useCallback(async () => {
    const client = getWalletClient();
    if (!client) {
      alert('No wallet found — install MetaMask, or sign in with Google instead.');
      return;
    }
    setConnecting(true);
    try {
      await ensureChain();
      const [addr] = await client.requestAddresses();
      setAddress(addr);
      setMode('external');
      api.upsertUser(addr).catch(() => {});
    } finally {
      setConnecting(false);
    }
  }, []);

  // ---------------------------------------------------------- embedded
  const connectSocial = useCallback(async (provider: SocialProvider) => {
    // opened synchronously by the caller's click; opening it after an await
    // gets it blocked on mobile Safari
    const popup = openAuthPopup();
    setConnecting(true);
    try {
      const s = await socialLogin(provider, popup);
      setSession(s);
      setAddress(s.address as Address);
      setMode('embedded');
      api.upsertUser(s.address).catch(() => {});
      try {
        const me = await walletApi.me(s.token);
        setHasPin(me.has_pin);
      } catch { /* non-fatal */ }
    } finally {
      setConnecting(false);
    }
  }, []);

  const unlock = useCallback(async (pin: string) => {
    const s = loadSession();
    if (!s) throw new Error('Not signed in');
    await unlockWithPin(s.token, pin, botchain.id);
    setUnlocked(true);
  }, []);

  const lock = useCallback(() => {
    lockKey();
    setUnlocked(false);
  }, []);

  const setPin = useCallback(async (pin: string, currentPin?: string) => {
    const s = loadSession();
    if (!s) throw new Error('Not signed in');
    await walletApi.setPin(s.token, pin, currentPin);
    setHasPin(true);
  }, []);

  const disconnect = useCallback(() => {
    clearSession();
    setAddress('');
    setSession(null);
    setMode('none');
    setHasPin(false);
    setUnlocked(false);
  }, []);

  const signMessage = useCallback(
    async (message: string) => {
      const local = getSigningAccount();
      if (local) return local.signMessage({ message });
      const client = getWalletClient();
      if (!client || !address) throw new Error('Wallet not connected');
      return client.signMessage({ account: address as Address, message });
    },
    [address],
  );

  // Follow account changes in an injected wallet (external mode only).
  useEffect(() => {
    if (mode !== 'external') return;
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accts: string[]) => setAddress((accts[0] as Address) ?? '');
    eth.on('accountsChanged', onAccounts);
    return () => eth.removeListener?.('accountsChanged', onAccounts);
  }, [mode]);

  const value = useMemo<WalletContextValue>(() => ({
    address,
    connected: !!address,
    connecting,
    mode,
    unlocked,
    hasPin,
    session,
    connect,
    connectSocial,
    disconnect,
    signMessage,
    unlock,
    lock,
    setPin,
    refreshAccount,
  }), [address, connecting, mode, unlocked, hasPin, session, connect,
       connectSocial, disconnect, signMessage, unlock, lock, setPin, refreshAccount]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export function shortAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}
