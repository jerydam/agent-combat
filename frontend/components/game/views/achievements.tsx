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
}

export function AchievementsView() {
  const { address, connected, connect, signMessage } = useWallet();
  const [points, setPoints] = useState(0);
  const [achs, setAchs] = useState<Ach[]>([]);
  const [claiming, setClaiming] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    const r = await fetch(`${API}/market/achievements/${address}`);
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
          <h1 className="font-display text-3xl font-bold tracking-wide">ACHIEVEMENT ROOM</h1>
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
                  ? 'border-primary/50 bg-primary/5 shadow-[0_0_16px_rgba(20,184,166,0.12)]'
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
            <p className={cn('mt-2 text-xs font-semibold', a.claimed ? 'text-amber-300' : 'text-primary')}>
              {a.claimed ? 'CLAIMED' : `+${a.points} pts`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
