'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Award, Loader2, Lock, Star } from 'lucide-react';
import { toast } from 'sonner';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface Ach {
  id: string; name: string; desc: string; points: number;
  earned: boolean; claimed: boolean;
  /** progress toward the goal — current is already clamped to target */
  current: number; target: number; floor: number; unit: string;
}

/**
 * Fraction complete, measured from `floor` rather than zero.
 *
 * ELO is the reason this exists: it starts at 1000, so a "reach 1100"
 * goal measured from zero would render as 91% done for someone who has
 * never fought a single battle.
 */
function pctOf(a: Ach): number {
  const span = a.target - a.floor;
  if (span <= 0) return a.earned ? 100 : 0;
  return Math.max(0, Math.min(100, ((a.current - a.floor) / span) * 100));
}

export function AchievementsView() {
  const { address, connected, connect, signMessage } = useWallet();
  const [points, setPoints] = useState(0);
  const [achs, setAchs] = useState<Ach[]>([]);
  const [claiming, setClaiming] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    // no-store: this is refetched immediately after claiming, and a
    // replayed cache response would show the pre-claim state
    const r = await fetch(`${API}/market/achievements/${address}`, { cache: 'no-store' });
    const data = await r.json();
    setPoints(data.points);
    setAchs(data.achievements);
  }, [address]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const claimable = achs.filter((a) => a.earned && !a.claimed);

  async function claimAll() {
    setClaiming(true);
    try {
      const signature = await signMessage('agent-arena:market:claim');
      const r = await fetch(`${API}/market/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail ?? 'Claim failed');
      // flip the claimed badges immediately, then reconcile
      const ids: string[] = data.claimed ?? [];
      setAchs((cur) => cur.map((a) => (ids.includes(a.id) ? { ...a, claimed: true } : a)));
      setPoints(data.points);
      toast.success(`+${data.points_gained} points claimed!`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Claim failed');
    } finally {
      setClaiming(false);
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <Award className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Connect your wallet to see your achievements.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-steel">ACHIEVEMENT ROOM</h1>
          <div className="split-line mt-2 w-32" />
          <p className="mt-1 text-sm text-muted-foreground">
            Earn points, spend them in the Market on skins, boosts, and powers.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-display text-2xl font-bold text-amber-300">
              <Star className="mb-1 mr-1 inline h-5 w-5" />{points}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">points</div>
          </div>
          <Button onClick={claimAll} disabled={claiming || claimable.length === 0} className="font-display tracking-wider">
            {claiming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Award className="mr-2 h-4 w-4" />}
            CLAIM {claimable.length > 0 ? `(${claimable.reduce((s, a) => s + a.points, 0)})` : ''}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {achs.map((a) => (
          <div
            key={a.id}
            className={cn(
              'rounded-xl border p-4 transition-colors',
              a.claimed
                ? 'border-amber-400/40 bg-amber-400/5'
                : a.earned
                  ? 'border-primary/50 bg-primary/5 shadow-[0_0_16px_hsl(204_95%_53%/0.18)]'
                  : 'border-border bg-card/40 opacity-60',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-display font-bold">{a.name}</div>
              {a.claimed ? (
                <Star className="h-4 w-4 shrink-0 text-amber-300" />
              ) : a.earned ? (
                <Award className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{a.desc}</p>

            {/* progress — shown even once earned, so the card always
                explains WHY it is (or isn't) unlocked */}
            {(() => {
              const pct = pctOf(a);
              return (
                <div className="mt-2.5">
                  <div className="mb-1 flex items-baseline justify-between text-[11px]">
                    <span className={cn('font-semibold tabular-nums',
                      a.earned ? 'text-success' : 'text-muted-foreground')}>
                      {a.current.toLocaleString()} / {a.target.toLocaleString()}
                      {a.unit ? ` ${a.unit}` : ''}
                    </span>
                    <span className={cn('tabular-nums',
                      a.earned ? 'text-success' : 'text-muted-foreground')}>
                      {Math.floor(pct)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn('h-full rounded-full transition-[width] duration-500',
                        a.claimed ? 'bg-amber-300'
                          : a.earned ? 'bg-success'
                            : 'bg-gradient-to-r from-primary/70 to-primary')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            <p className={cn('mt-2 text-xs font-semibold', a.claimed ? 'text-amber-300' : 'text-primary')}>
              {a.claimed ? 'CLAIMED' : `+${a.points} pts`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}