'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { writeContract } from '@/lib/tx';
import { getPublicClient } from '@/lib/chain';
import { ADDRESSES, SOLO_ARENA_ABI } from '@/lib/contracts';
import type { SoloGame } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Coins, Loader2, RefreshCw, Trophy, Wallet, AlertTriangle, Check, Clock,
} from 'lucide-react';

/** On-chain SoloArena.Status */
const ST_PENDING = 1;
const ST_RESOLVED = 2;
const ST_RECLAIMED = 3;

const bot = (wei: string) => Number(formatEther(BigInt(wei || '0'))).toFixed(2);

export function RewardsView() {
  const { address, connected, connect } = useWallet();
  const [games, setGames] = useState<SoloGame[]>([]);
  const [chainStatus, setChainStatus] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  /**
   * The chain is the only trustworthy source for "is this stake still
   * claimable". The backend mirror can lag — if a reclaim happened while
   * the listener was down it never saw the event — so every row is
   * verified against SoloArena.getGame before we offer a button. That is
   * what stops an already-reclaimed stake from showing a live Reclaim
   * action that can only revert.
   */
  const verifyOnChain = useCallback(async (rows: SoloGame[]) => {
    if (!rows.length || !ADDRESSES.soloArena || ADDRESSES.soloArena === '0x') return {};
    const client = getPublicClient();
    const out: Record<number, number> = {};
    await Promise.all(rows.map(async (g) => {
      try {
        const res = await client.readContract({
          address: ADDRESSES.soloArena,
          abi: SOLO_ARENA_ABI as any,
          functionName: 'getGame',
          args: [BigInt(g.game_id)],
        }) as readonly [string, bigint, bigint, bigint, number, boolean];
        out[g.game_id] = Number(res[4]);
      } catch { /* leave unknown; row stays informational */ }
    }));
    return out;
  }, []);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const rows = await api.soloGamesFor(address);
      setGames(rows);
      setChainStatus(await verifyOnChain(rows));
    } catch {
      toast.error('Could not load your stakes');
    } finally {
      setLoading(false);
    }
  }, [address, verifyOnChain]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const reclaim = useCallback(async (gameId: number) => {
    if (!address) return;
    setBusy(gameId);
    try {
      await writeContract({
        address: ADDRESSES.soloArena,
        abi: SOLO_ARENA_ABI as any,
        functionName: 'reclaim',
        args: [BigInt(gameId)],
        account: address as `0x${string}`,
      });
      toast.success('Stake reclaimed — back in your wallet');
      // mark it locally at once, then re-verify against the chain
      setChainStatus((s) => ({ ...s, [gameId]: ST_RECLAIMED }));
      await load();
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? 'Reclaim failed');
      await load().catch(() => {});
    } finally {
      setBusy(null);
    }
  }, [address, load]);

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <Wallet className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Connect your wallet to see your stakes.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  // Bucket every stake by what the PLAYER can actually do about it.
  const onChain = (g: SoloGame) => chainStatus[g.game_id];
  const settled = games.filter((g) => onChain(g) === ST_RESOLVED);
  const reclaimed = games.filter((g) => onChain(g) === ST_RECLAIMED);
  const open = games.filter((g) => onChain(g) === ST_PENDING || onChain(g) === undefined);
  const canReclaim = open.filter((g) => g.reclaimable);
  const waiting = open.filter((g) => !g.reclaimable);

  const owed = settled.reduce(
    (s, g) => s + (g.player_won ? Number(formatEther(BigInt(g.stake_wei))) * 1.8 : 0), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-wide text-steel sm:text-3xl">REWARDS</h1>
          <div className="split-line mt-2 w-32" />
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Every stake you&apos;ve placed in the arena. Wins are paid out automatically;
            if a fight never got a result you can pull your own stake back here after
            an hour.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {/* ---------------------------------------------- action required */}
      <Section
        title="Ready to reclaim"
        icon={Coins}
        tone="warning"
        empty="Nothing to reclaim — every stake is settled."
        hint="These fights never got a result on-chain, so the contract lets you take your stake back."
        rows={canReclaim}
      >
        {(g) => (
          <Button size="sm" disabled={busy === g.game_id} onClick={() => reclaim(g.game_id)}>
            {busy === g.game_id
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : `Reclaim ${bot(g.stake_wei)} BOT`}
          </Button>
        )}
      </Section>

      {/* ---------------------------------------------------- in flight */}
      {waiting.length > 0 && (
        <Section
          title="In progress"
          icon={Clock}
          tone="muted"
          empty=""
          hint="Still within the 1-hour window. If the payout doesn't land, these become reclaimable."
          rows={waiting}
        >
          {(g) => (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {g.awaiting_payout && <Loader2 className="h-3 w-3 animate-spin" />}
              {g.awaiting_payout ? 'Paying out…' : 'Awaiting result'}
            </span>
          )}
        </Section>
      )}

      {/* --------------------------------------------------- settled/paid */}
      {settled.length > 0 && (
        <Section
          title="Settled"
          icon={Trophy}
          tone="success"
          empty=""
          hint={owed > 0 ? `${owed.toFixed(2)} BOT paid out to this wallet.` : undefined}
          rows={settled}
        >
          {(g) => (
            <span className={cn('font-display text-xs font-bold',
              g.player_won ? 'text-success' : 'text-muted-foreground')}>
              {g.player_won
                ? `+${(Number(formatEther(BigInt(g.stake_wei))) * 1.8).toFixed(2)} BOT`
                : 'Lost'}
            </span>
          )}
        </Section>
      )}

      {/* ------------------------------------------------ already reclaimed */}
      {reclaimed.length > 0 && (
        <Section
          title="Already reclaimed"
          icon={Check}
          tone="muted"
          empty=""
          hint="You've already taken these stakes back — no action left."
          rows={reclaimed}
        >
          {(g) => (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5" /> Returned
            </span>
          )}
        </Section>
      )}

      {!loading && games.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 py-16 text-center">
          <Coins className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            You haven&apos;t staked on a fight yet.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  title, icon: Icon, tone, hint, empty, rows, children,
}: {
  title: string;
  icon: React.ElementType;
  tone: 'warning' | 'success' | 'muted';
  hint?: string;
  empty: string;
  rows: SoloGame[];
  children: (g: SoloGame) => React.ReactNode;
}) {
  if (rows.length === 0 && !empty) return null;
  const toneCls = {
    warning: 'border-warning/50 text-warning',
    success: 'border-success/50 text-success',
    muted: 'border-border text-muted-foreground',
  }[tone];

  return (
    <div className={cn('rounded-xl border bg-card/40 p-4', toneCls.split(' ')[0])}>
      <div className={cn('flex items-center gap-2 font-display text-sm font-bold tracking-wider', toneCls.split(' ')[1])}>
        <Icon className="h-4 w-4" />
        {title.toUpperCase()}
        {rows.length > 0 && <span className="opacity-70">· {rows.length}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}

      {rows.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 opacity-50" /> {empty}
        </p>
      ) : (
        <div className="mt-3 divide-y divide-border/60">
          {rows.map((g) => (
            <div key={g.game_id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-display text-sm">Game #{g.game_id}</div>
                <div className="text-xs text-muted-foreground">
                  {bot(g.stake_wei)} BOT staked
                  {g.agent_id ? ` · agent #${g.agent_id}` : ''}
                </div>
              </div>
              {children(g)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
