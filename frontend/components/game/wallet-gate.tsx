'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Lock, ShieldCheck, Wallet, X } from 'lucide-react';

/** Google's mark, inlined — no external asset, works offline. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#4285F4" d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2 3.44-4.96 3.44-8.56Z" />
      <path fill="#34A853" d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.55-2.03-6.46-4.76H1.7v2.98A11.5 11.5 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.54 14.66a6.9 6.9 0 0 1 0-4.4V7.28H1.7a11.5 11.5 0 0 0 0 10.36l3.84-2.98Z" />
      <path fill="#EA4335" d="M12 4.75c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.72 1.28 15.1.25 12 .25 7.5.25 3.6 2.84 1.7 6.62l3.84 2.98C6.45 6.87 9 4.75 12 4.75Z" />
    </svg>
  );
}

/**
 * Sign-in sheet.
 *
 * Google is the primary path and external wallets are the escape hatch,
 * not the other way round: this is a mobile game, and "install a browser
 * extension first" loses most players before they ever see a fight.
 */
export function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectSocial, connect, connecting } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);

  if (!open) return null;

  const google = async () => {
    setBusy('google');
    try {
      await connectSocial('google');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Google sign-in failed');
    } finally { setBusy(null); }
  };

  const external = async () => {
    setBusy('external');
    try { await connect(); onClose(); }
    catch (e: any) { toast.error(e?.message ?? 'Could not connect'); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl border border-border bg-card p-5 sm:rounded-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-steel">GET STARTED</h2>
          <button onClick={onClose} className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Sign in and a wallet is created for you automatically — no extension, no
          seed phrase to write down. You can fund it and export it any time.
        </p>

        <Button onClick={google} disabled={!!busy || connecting}
          className="h-12 w-full justify-center gap-2.5 bg-white text-[#1f1f1f] hover:bg-white/90">
          {busy === 'google'
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <GoogleMark className="h-5 w-5" />}
          <span className="font-semibold">Continue with Google</span>
        </Button>

        <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" onClick={external} disabled={!!busy || connecting}
          className="h-11 w-full justify-center gap-2">
          {busy === 'external' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          Use my own wallet
        </Button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          MetaMask or any injected wallet on Botchain
        </p>
      </div>
    </div>
  );
}

/**
 * PIN gate for embedded wallets.
 *
 * The wallet service can hand back a key but cannot sign for us, so the key
 * has to be unlocked into memory before the player can transact. One PIN
 * entry covers the whole session — asking per transaction would mean
 * re-typing it before every mint, stake and purchase.
 */
export function PinGate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { hasPin, unlock, setPin } = useWallet();
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const creating = !hasPin;

  useEffect(() => { if (open) { setPinValue(''); setConfirm(''); } }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (pin.length !== 6) return toast.error('PIN must be exactly 6 digits');
    if (creating && pin !== confirm) return toast.error('The two PINs do not match');
    setBusy(true);
    try {
      if (creating) {
        await setPin(pin);
        await unlock(pin);
        toast.success('PIN set — your wallet is unlocked');
      } else {
        await unlock(pin);
        toast.success('Wallet unlocked');
      }
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not unlock');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl border border-border bg-card p-5 sm:rounded-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-steel">
            {creating ? <ShieldCheck className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-primary" />}
            {creating ? 'CREATE A PIN' : 'ENTER YOUR PIN'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {creating
            ? 'Six digits. This authorises transactions from your wallet — pick something you will remember, it cannot be recovered without your security questions.'
            : 'Unlocks your wallet for this session so you can mint, stake and buy.'}
        </p>

        <div className="mb-1.5 font-display text-[10px] tracking-widest text-muted-foreground">
          {creating ? 'NEW PIN' : 'PIN'}
        </div>
        <input
          value={pin}
          onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter' && !creating) submit(); }}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="······"
          autoFocus
          className="h-12 w-full rounded-lg border border-border bg-input px-3 text-center font-display text-2xl tracking-[0.5em] outline-none focus:border-primary"
        />
        {creating && (
          <>
            <div className="mb-1.5 mt-3 font-display text-[10px] tracking-widest text-muted-foreground">
              CONFIRM
            </div>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              type="password"
              inputMode="numeric"
              placeholder="······"
              className="h-12 w-full rounded-lg border border-border bg-input px-3 text-center font-display text-2xl tracking-[0.5em] outline-none focus:border-primary"
            />
          </>
        )}

        <Button onClick={submit} disabled={busy || pin.length !== 6}
          className="mt-3 h-11 w-full font-display tracking-widest">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {creating ? 'SET PIN & UNLOCK' : 'UNLOCK'}
        </Button>
      </div>
    </div>
  );
}
