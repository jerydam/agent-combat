'use client';

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

/**
 * Embedded (social-login) wallet client.
 *
 * Players sign in with Google and a wallet is generated for them server-side.
 * No extension, no seed phrase to write down before they can play — which is
 * the whole point on mobile, where "install MetaMask first" loses most of
 * your players before they've seen the game.
 *
 * ── How signing works, and why ──────────────────────────────────────────
 * The wallet service has NO transaction-signing endpoint: it can custody a
 * key and hand it back, but it cannot sign for you. So to send a
 * transaction we must hold the key locally:
 *
 *     PIN -> /wallet/verify-pin -> single-use signing grant (120s)
 *         -> /wallet/export-privatekey -> viem local account (memory only)
 *
 * That key is kept in a module-local variable, never in localStorage,
 * sessionStorage, cookies, or React state, and is dropped on lock/logout.
 * It is still, unavoidably, in the page's memory while unlocked — an XSS
 * on this origin would be able to steal it. The right long-term fix is a
 * `POST /wallet/sign-transaction` on the wallet service so the key never
 * leaves it; until that exists this is the only workable design.
 */

const WALLET_API =
  process.env.NEXT_PUBLIC_WALLET_API ??
  'https://thoughtful-carmencita-faucetdrops-02a54589.koyeb.app';

const SESSION_KEY = 'agent-arena:wallet-session';

export interface WalletSession {
  token: string;
  address: string;
  solana_address?: string | null;
  stellar_address?: string | null;
  linked_socials: string[];
}

export interface WalletMe {
  address: string;
  wallet_type: 'embedded' | 'external';
  linked_socials: string[];
  created_at: string;
  has_pin: boolean;
  has_security_questions: boolean;
}

/** Thrown when a transaction is attempted while the wallet is locked. */
export class WalletLockedError extends Error {
  constructor() {
    super('Wallet is locked — enter your PIN to authorise this transaction.');
    this.name = 'WalletLockedError';
  }
}

// ---------------------------------------------------------------- session

export function loadSession(): WalletSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as WalletSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: WalletSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  lock();
}

// ------------------------------------------------------- the unlocked key
//
// Deliberately a module-local binding: not exported, not in React state
// (which ends up in devtools and in any error-reporting payload that
// serialises props), and never persisted.

let _account: PrivateKeyAccount | null = null;

export function getSigningAccount(): PrivateKeyAccount | null {
  return _account;
}

export function isUnlocked(): boolean {
  return _account !== null;
}

export function lock(): void {
  _account = null;
}

// ------------------------------------------------------------------ HTTP

async function req<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${WALLET_API}${path}`, {
    method: opts.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!res.ok) {
    throw new Error(
      typeof data?.detail === 'string' ? data.detail : `Wallet service error (${res.status})`,
    );
  }
  return data as T;
}

// ----------------------------------------------------------- social login

export type SocialProvider = 'google' | 'twitter' | 'discord' | 'github';

/**
 * Runs the OAuth dance in a popup and returns a session.
 *
 * The service is a redirect-based OAuth broker: we open its /api/auth/<p>
 * endpoint with a state we generated, it bounces through the provider, and
 * we poll /api/auth/session until the credential shows up. The popup must
 * be opened synchronously inside the click handler or mobile browsers
 * block it.
 */
export async function socialLogin(
  provider: SocialProvider,
  popup: Window | null,
): Promise<WalletSession> {
  const state = crypto.randomUUID();
  const authUrl = `${WALLET_API}/api/auth/${provider}?client_state=${encodeURIComponent(state)}`;

  if (popup) popup.location.href = authUrl;
  else window.location.href = authUrl; // popup blocked: fall back to redirect

  // Poll for the credential the callback stashes against our state.
  //
  // Two failure modes are worth telling apart, because they look identical
  // from inside the loop and only one is the user's fault:
  //
  //  - HTTP 404 "Unknown state": normal at first (the popup hasn't hit
  //    /api/auth/<p> yet) and terminal later (the session is single-use, so
  //    once a `done` response is read it is gone).
  //  - TypeError "Failed to fetch": the request never completed — almost
  //    always CORS, i.e. this origin isn't on the wallet service's
  //    allowlist. Retrying for five minutes just hides a config bug, so we
  //    give up quickly and say what's actually wrong.
  const started = Date.now();
  let credential: string | null = null;
  let networkFailures = 0;

  while (Date.now() - started < 300_000) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const s = await req<{ status: string; provider?: string; credential?: string }>(
        `/api/auth/session?state=${encodeURIComponent(state)}`,
      );
      networkFailures = 0;
      if (s.status === 'done' && s.credential) {
        credential = s.credential;
        break;
      }
    } catch (e: any) {
      // `req` throws Error for HTTP errors; fetch itself throws TypeError
      // when the request was blocked before a response was readable.
      const blocked = e instanceof TypeError
        || /failed to fetch|networkerror|load failed/i.test(e?.message ?? '');
      if (blocked && ++networkFailures >= 4) {
        try { popup?.close(); } catch { /* cross-origin */ }
        throw new Error(
          `Cannot reach the wallet service from ${window.location.origin}. ` +
          `This is almost always CORS — add this exact origin (including the ` +
          `"www." if present) to ALLOWED_ORIGINS on the wallet backend.`,
        );
      }
      /* otherwise: 404 while the state registers — keep trying */
    }
    // Popup gone and nothing arrived: the user closed it or cancelled.
    if (popup?.closed && Date.now() - started > 4000 && !credential) break;
  }
  try { popup?.close(); } catch { /* cross-origin */ }

  if (!credential) throw new Error('Sign-in was cancelled or timed out — please try again');

  const session = await req<WalletSession & { evm_address?: string }>(
    '/wallet/social-login',
    { method: 'POST', body: { provider, credential } },
  );
  const out: WalletSession = {
    token: session.token,
    address: (session.evm_address ?? session.address).toLowerCase(),
    solana_address: session.solana_address ?? null,
    stellar_address: session.stellar_address ?? null,
    linked_socials: session.linked_socials ?? [],
  };
  saveSession(out);
  return out;
}

// ---------------------------------------------------------------- account

export const walletApi = {
  me: (token: string) => req<WalletMe>('/wallet/me', { token }),

  addresses: (token: string) =>
    req<{ evm: string; solana: string | null; stellar: string | null;
          wallet_type: string; has_mnemonic: boolean }>('/wallet/all-addresses', { token }),

  setPin: (token: string, pin: string, currentPin?: string) =>
    req<{ success: boolean }>('/wallet/set-pin', {
      method: 'POST', token,
      body: { pin, ...(currentPin ? { current_pin: currentPin } : {}) },
    }),

  /** Returns a single-use grant, valid ~2 minutes. */
  verifyPin: (token: string, pin: string) =>
    req<{ signing_grant: string; expires_in: number }>('/wallet/verify-pin', {
      method: 'POST', token, body: { pin },
    }),

  exportPrivateKey: (token: string, grant: string, chainId: number) =>
    req<{ address: string; private_key: string }>('/wallet/export-privatekey', {
      method: 'POST', token, body: { chain_id: chainId, signing_grant: grant },
    }),

  exportSeed: (token: string, grant: string) =>
    req<{ mnemonic: string; addresses: Record<string, string> }>('/wallet/export-seed', {
      method: 'POST', token, body: { signing_grant: grant },
    }),

  securityQuestions: (token: string) =>
    req<{ has_security_questions: boolean; questions: string[] }>(
      '/wallet/security-questions', { token }),

  setSecurityQuestions: (
    token: string,
    items: { question: string; answer: string }[],
    currentPin?: string,
  ) =>
    req<{ success: boolean }>('/wallet/security-questions/set', {
      method: 'POST', token,
      body: { items, ...(currentPin ? { current_pin: currentPin } : {}) },
    }),

  verifySecurityAnswers: (token: string, answers: { question: string; answer: string }[]) =>
    req<{ reset_grant: string }>('/wallet/security-questions/verify', {
      method: 'POST', token, body: { answers },
    }),

  resetPin: (token: string, pin: string, resetGrant: string) =>
    req<{ success: boolean }>('/wallet/reset-pin', {
      method: 'POST', token, body: { pin, reset_grant: resetGrant },
    }),

  linkSocial: (token: string, provider: string, credential: string) =>
    req<{ linked_socials: string[] }>('/wallet/link-social', {
      method: 'POST', token, body: { provider, credential },
    }),

  unlinkSocial: (token: string, provider: string) =>
    req<{ linked_socials: string[] }>('/wallet/unlink-social', {
      method: 'POST', token, body: { provider },
    }),
};

/**
 * Exchange a PIN for an in-memory signing account.
 *
 * One PIN entry unlocks the wallet for the session rather than per
 * transaction: the grant is single-use and only lives 2 minutes, so
 * re-exporting per transaction would mean re-typing the PIN for every
 * single fight, mint and purchase. That is unusable in a game.
 */
export async function unlockWithPin(
  token: string,
  pin: string,
  chainId: number,
): Promise<PrivateKeyAccount> {
  const { signing_grant } = await walletApi.verifyPin(token, pin);
  const { private_key } = await walletApi.exportPrivateKey(token, signing_grant, chainId);
  const key = (private_key.startsWith('0x') ? private_key : `0x${private_key}`) as `0x${string}`;
  _account = privateKeyToAccount(key);
  return _account;
}

/** Open a popup synchronously (before any await) so mobile doesn't block it. */
export function openAuthPopup(): Window | null {
  try {
    return window.open('', '_blank', 'width=480,height=720');
  } catch {
    return null;
  }
}
