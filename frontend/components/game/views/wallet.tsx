'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { toast } from 'sonner';
import { useWallet, shortAddr } from '@/lib/wallet';
import { getPublicClient, botchain } from '@/lib/chain';
import { loadSession, walletApi } from '@/lib/embedded-wallet';
import { PinGate, SignInSheet } from '@/components/game/wallet-gate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Check, Copy, Eye, EyeOff, Lock, LogOut, RefreshCw,
  ShieldCheck, Unlock, Wallet as WalletIcon, KeyRound, Loader2, Download,
} from 'lucide-react';

const EXPLORER = botchain.blockExplorers?.default.url ?? '';

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 truncate text-right', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { toast.error('Could not copy'); }
  };
  return (
    <div className="rounded-lg border border-border bg-background/50 p-2.5">
      <div className="font-display text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <button onClick={copy} className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
          {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function WalletView() {
  const {
    address, connected, mode, unlocked, hasPin, session, disconnect, lock,
  } = useWallet();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [addresses, setAddresses] = useState<{ evm: string; solana: string | null; stellar: string | null } | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [revealPin, setRevealPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sq, setSq] = useState<{ has_security_questions: boolean; questions: string[] } | null>(null);

  const embedded = mode === 'embedded';

  const loadBalance = useCallback(async () => {
    if (!address) return;
    try {
      setBalance(await getPublicClient().getBalance({ address: address as `0x${string}` }));
    } catch { /* rpc hiccup */ }
  }, [address]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  useEffect(() => {
    if (!embedded) return;
    const s = loadSession();
    if (!s) return;
    walletApi.addresses(s.token).then((a) => setAddresses(a)).catch(() => {});
    walletApi.securityQuestions(s.token).then(setSq).catch(() => {});
  }, [embedded, hasPin]);

  /** Reveal the recovery phrase — the one thing that makes this non-custodial. */
  const revealSeed = async () => {
    const s = loadSession();
    if (!s) return;
    if (revealPin.length !== 6) return toast.error('Enter your 6-digit PIN');
    setBusy('seed');
    try {
      const { signing_grant } = await walletApi.verifyPin(s.token, revealPin);
      const { mnemonic } = await walletApi.exportSeed(s.token, signing_grant);
      setSeed(mnemonic);
      setRevealPin('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not export');
    } finally { setBusy(null); }
  };

  if (!connected) {
    return (
      <>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
          <WalletIcon className="h-10 w-10 text-muted-foreground" />
          <h1 className="font-display text-2xl font-bold text-steel">YOUR WALLET</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with Google and a wallet is created for you instantly — then fund it
            with BOT to mint agents, stake on fights and buy avatars.
          </p>
          <Button onClick={() => setShowSignIn(true)} size="lg" className="font-display tracking-widest">
            GET STARTED
          </Button>
        </div>
        <SignInSheet open={showSignIn} onClose={() => setShowSignIn(false)} />
      </>
    );
  }

  const bal = balance !== null ? Number(formatEther(balance)) : null;
  const empty = bal !== null && bal === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-steel sm:text-3xl">WALLET</h1>
          <div className="split-line mt-2 w-32" />
          <p className="mt-2 text-sm text-muted-foreground">
            {embedded
              ? 'Created for you when you signed in. It is yours — export the recovery phrase any time.'
              : 'Connected external wallet.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadBalance}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* ---------------------------------------------------- balance */}
      <div className="rounded-2xl border border-primary/40 bg-vs-split p-5">
        <div className="font-display text-[10px] tracking-[0.3em] text-muted-foreground">BALANCE</div>
        <div className="mt-1 font-display text-4xl font-black text-steel">
          {bal === null ? '—' : bal.toFixed(4)} <span className="text-lg text-primary">BOT</span>
        </div>
        <div className="mt-3">
          <CopyField label="YOUR ADDRESS (BOTCHAIN)" value={address} />
        </div>
        {EXPLORER && (
          <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer"
            className="mt-2 inline-block text-[11px] text-primary hover:underline">
            View on explorer ↗
          </a>
        )}
      </div>

      {empty && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
          <div className="flex items-center gap-2 font-display text-sm font-bold text-warning">
            <AlertTriangle className="h-4 w-4" /> FUND YOUR WALLET TO PLAY
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your wallet is empty. Send BOT to the address above — from an exchange, or from
            another wallet — on <b className="text-foreground">Botchain (chain {botchain.id})</b>.
            You need a small amount for gas before you can mint an agent, and more if you
            want to stake on fights.
          </p>
        </div>
      )}

      {/* ------------------------------------------------- embedded only */}
      {embedded && (
        <>
          {/* unlock state */}
          <div className={cn('rounded-xl border p-4',
            unlocked ? 'border-success/40 bg-success/5' : 'border-border bg-card/40')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {unlocked
                  ? <Unlock className="h-4 w-4 text-success" />
                  : <Lock className="h-4 w-4 text-muted-foreground" />}
                <div>
                  <div className="font-display text-sm font-bold">
                    {unlocked ? 'Unlocked for this session' : hasPin ? 'Locked' : 'No PIN set yet'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {unlocked
                      ? 'You can mint, stake and buy without re-entering your PIN.'
                      : hasPin
                        ? 'Enter your PIN to authorise transactions.'
                        : 'Set a 6-digit PIN before your first transaction.'}
                  </p>
                </div>
              </div>
              {unlocked ? (
                <Button size="sm" variant="outline" onClick={lock}>Lock</Button>
              ) : (
                <Button size="sm" onClick={() => setShowPin(true)}>
                  {hasPin ? 'Unlock' : 'Set PIN'}
                </Button>
              )}
            </div>
          </div>

          {/* account details */}
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-2 font-display text-sm font-bold tracking-wide">ACCOUNT</div>
            <Row label="Type" value="Embedded (social sign-in)" />
            <Row label="Signed in with" value={(session?.linked_socials ?? []).join(', ') || '—'} />
            <Row label="Network" value={`${botchain.name} · ${botchain.id}`} />
            <Row label="PIN" value={hasPin ? 'Set' : 'Not set'} />
            <Row label="Security questions" value={sq?.has_security_questions ? 'Set' : 'Not set'} />
          </div>

          {/* other chains this seed controls */}
          {addresses && (addresses.solana || addresses.stellar) && (
            <div className="space-y-2 rounded-xl border border-border bg-card/40 p-4">
              <div className="font-display text-sm font-bold tracking-wide">OTHER ADDRESSES</div>
              <p className="text-xs text-muted-foreground">
                The same recovery phrase controls these. Agent Arena only uses the Botchain
                address above.
              </p>
              {addresses.solana && <CopyField label="SOLANA" value={addresses.solana} />}
              {addresses.stellar && <CopyField label="STELLAR" value={addresses.stellar} />}
            </div>
          )}

          {/* recovery */}
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-1 flex items-center gap-2 font-display text-sm font-bold tracking-wide">
              <KeyRound className="h-4 w-4 text-warning" /> RECOVERY PHRASE
            </div>
            <p className="text-xs text-muted-foreground">
              Twelve words that <b className="text-foreground">are</b> your wallet. Anyone who
              has them owns your agents and your BOT. Write them down offline and never paste
              them into anything.
            </p>

            {seed ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg border border-warning/50 bg-warning/5 p-3">
                  {seed.split(' ').map((w, i) => (
                    <div key={i} className="text-xs">
                      <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                      <span className="font-mono">{w}</span>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-2"
                  onClick={() => setSeed(null)}>
                  <EyeOff className="mr-2 h-3.5 w-3.5" /> Hide
                </Button>
              </>
            ) : hasPin ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={revealPin}
                  onChange={(e) => setRevealPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  type="password" inputMode="numeric" placeholder="PIN"
                  className="h-9 w-28 rounded-lg border border-border bg-input px-3 text-center font-display tracking-[0.3em] outline-none focus:border-warning"
                />
                <Button size="sm" variant="outline" disabled={busy === 'seed'} onClick={revealSeed}>
                  {busy === 'seed'
                    ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    : <Eye className="mr-2 h-3.5 w-3.5" />}
                  Reveal phrase
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-warning">Set a PIN first to export your phrase.</p>
            )}
          </div>

          {/* security questions */}
          <SecurityQuestions has={!!sq?.has_security_questions} questions={sq?.questions ?? []}
            hasPin={hasPin} onSaved={() => {
              const s = loadSession();
              if (s) walletApi.securityQuestions(s.token).then(setSq).catch(() => {});
            }} />
        </>
      )}

      <Button variant="outline" onClick={disconnect} className="w-full">
        <LogOut className="mr-2 h-4 w-4" /> Sign out
      </Button>

      <PinGate open={showPin} onClose={() => setShowPin(false)} />
    </div>
  );
}

/** Forgot-PIN recovery. Without these, a lost PIN means a lost wallet. */
function SecurityQuestions({ has, questions, hasPin, onSaved }: {
  has: boolean; questions: string[]; hasPin: boolean; onSaved: () => void;
}) {
  const [items, setItems] = useState([
    { question: 'What was the name of your first pet?', answer: '' },
    { question: 'What city were you born in?', answer: '' },
    { question: 'What was your first school called?', answer: '' },
  ]);
  const [currentPin, setCurrentPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const save = async () => {
    const s = loadSession();
    if (!s) return;
    if (items.some((i) => i.answer.trim().length < 2)) {
      return toast.error('Answer all three questions (at least 2 characters each)');
    }
    setBusy(true);
    try {
      await walletApi.setSecurityQuestions(s.token, items, has ? currentPin : undefined);
      toast.success('Security questions saved');
      setItems(items.map((i) => ({ ...i, answer: '' })));
      setCurrentPin('');
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-display text-sm font-bold tracking-wide">
          <ShieldCheck className={cn('h-4 w-4', has ? 'text-success' : 'text-warning')} />
          SECURITY QUESTIONS
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Cancel' : has ? 'Replace' : 'Set up'}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {has
          ? 'Set. If you forget your PIN, answering these lets you choose a new one.'
          : 'Not set yet. Without these, forgetting your PIN means losing access to this wallet — set them now.'}
      </p>

      {open && (
        <div className="mt-3 space-y-2.5">
          {items.map((it, idx) => (
            <div key={idx}>
              <div className="mb-1 text-[11px] text-muted-foreground">{it.question}</div>
              <input
                value={it.answer}
                onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, answer: e.target.value } : x))}
                placeholder="Your answer"
                className="h-9 w-full rounded-lg border border-border bg-input px-3 text-sm outline-none focus:border-primary"
              />
            </div>
          ))}
          {has && hasPin && (
            <input
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="password" inputMode="numeric" placeholder="Current PIN"
              className="h-9 w-full rounded-lg border border-border bg-input px-3 text-center font-display tracking-[0.3em] outline-none focus:border-primary"
            />
          )}
          <Button size="sm" onClick={save} disabled={busy} className="w-full">
            {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
            Save answers
          </Button>
        </div>
      )}
    </div>
  );
}
