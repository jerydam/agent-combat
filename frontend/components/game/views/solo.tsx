'use client';

import { useEffect, useState } from 'react';
import { parseEther } from 'viem';
import { useWallet } from '@/lib/wallet';
import { api, waitForSolo } from '@/lib/api';
import { writeContract, eventArgs } from '@/lib/tx';
import { ADDRESSES, SOLO_ARENA_ABI } from '@/lib/contracts';
import type { Agent, BattleLog, Bot } from '@/lib/types';
import { AgentCard } from '@/components/game/agent-card';
import { AgentAvatar } from '@/components/game/agent-avatar';
import { BattleReplay } from '@/components/game/battle-replay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot as BotIcon, Loader2, Coins } from 'lucide-react';
import { toast } from 'sonner';

export function SoloView() {
  const { address, connected, connect } = useWallet();
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [stake, setStake] = useState('0');
  const [busy, setBusy] = useState<number | null>(null);
  const [log, setLog] = useState<BattleLog | null>(null);
  const [lastResult, setLastResult] = useState<{ won: boolean; payout: string } | null>(null);

  useEffect(() => {
    api.bots().then(setBots).catch(() => {});
  }, []);
  useEffect(() => {
    if (!connected) return;
    api.agents(address).then(setMyAgents).catch(() => {});
  }, [connected, address]);

  async function play(botId: number) {
    if (!selected) return toast.error('Pick your fighter first');
    setBusy(botId);
    setLog(null);
    setLastResult(null);
    try {
      const receipt = await writeContract({
        address: ADDRESSES.soloArena,
        abi: SOLO_ARENA_ABI as any,
        functionName: 'play',
        args: [BigInt(selected.token_id), BigInt(botId)],
        value: parseEther(stake || '0'),
        account: address as `0x${string}`,
      });
      const ev = eventArgs<{ gameId: bigint }>(receipt, SOLO_ARENA_ABI as any, 'SoloPlayed');
      if (!ev) throw new Error('Game event not found');
      const game = await waitForSolo(Number(ev.gameId));
      if (game.moves) setLog(game.moves);
      const staked = Number(stake) > 0;
      setLastResult({
        won: game.player_won,
        payout: staked && game.player_won ? `${(Number(stake) * 1.8).toFixed(2)} BOT` : '',
      });
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? 'Play failed');
    } finally {
      setBusy(null);
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-muted-foreground">Connect your wallet to fight the house.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">SOLO · VS THE HOUSE</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          House bots are real on-chain agents — they gain XP and evolve too. Play free, or stake BOT and win <span className="text-primary font-semibold">1.8x</span> if you beat them.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Your fighter</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {myAgents.map((a) => (
            <AgentCard key={a.token_id} agent={a} compact selected={selected?.token_id === a.token_id} onClick={() => setSelected(a)} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">House bots · easiest → hardest</h2>
          <div className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <Input value={stake} onChange={(e) => setStake(e.target.value)} className="h-8 w-24 bg-background/60 text-right" />
            <span className="text-muted-foreground">BOT stake (0 = free)</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {bots.map((b) => (
            <div key={b.token_id} className="flex items-center gap-3 rounded-xl border border-border bg-card/50 p-4">
              <AgentAvatar personality={b.personality} tier={b.tier ?? 1} name={b.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold">{b.name}</div>
                <div className="text-xs text-muted-foreground">
                  L{b.level} · ATK {b.attack} DEF {b.defense} SPD {b.speed} INT {b.intelligence} · {b.wins}W/{b.losses}L
                </div>
              </div>
              <Button size="sm" disabled={busy !== null || !selected} onClick={() => play(b.token_id)}>
                {busy === b.token_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><BotIcon className="mr-1 h-3.5 w-3.5" /> Fight{Number(stake) > 0 ? ` · ${stake} BOT` : ' free'}</>}
              </Button>
            </div>
          ))}
          {bots.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">No bots registered yet.</p>}
        </div>
      </section>

      {lastResult && (
        <div className={`rounded-xl border px-5 py-4 text-center font-display text-lg font-bold ${lastResult.won ? 'border-primary/50 text-primary text-glow' : 'border-destructive/50 text-destructive'}`}>
          {lastResult.won ? `VICTORY${lastResult.payout ? ` · +${lastResult.payout}` : ''}` : 'DEFEATED BY THE HOUSE'}
        </div>
      )}

      {log && (
        <Card className="border-border bg-card/60">
          <CardHeader><CardTitle className="font-display text-sm uppercase tracking-widest text-muted-foreground">Verified replay</CardTitle></CardHeader>
          <CardContent><BattleReplay log={log} /></CardContent>
        </Card>
      )}
    </div>
  );
}
