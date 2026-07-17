'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseEther } from 'viem';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import { writeContract, eventArgs } from '@/lib/tx';
import { ADDRESSES, BATTLE_ARENA_ABI } from '@/lib/contracts';
import type { Agent, MatchmakingEntry } from '@/lib/types';
import { AgentCard } from '@/components/game/agent-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Swords, Zap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function ArenaView() {
  const { address, connected, connect } = useWallet();
  const router = useRouter();
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [opponents, setOpponents] = useState<MatchmakingEntry[]>([]);
  const [stake, setStake] = useState('0');
  const [acceptId, setAcceptId] = useState('');
  const [acceptStake, setAcceptStake] = useState('0');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    api.agents(address).then(setMyAgents).catch(() => {});
  }, [connected, address]);

  useEffect(() => {
    if (!selected) return;
    api.matchmaking(selected.token_id).then(setOpponents).catch(() => setOpponents([]));
  }, [selected]);

  async function quickMatch(targetId: number) {
    if (!selected) return;
    setBusy(`quick-${targetId}`);
    try {
      const receipt = await writeContract({
        address: ADDRESSES.battleArena,
        abi: BATTLE_ARENA_ABI as any,
        functionName: 'quickMatch',
        args: [BigInt(selected.token_id), BigInt(targetId)],
        account: address as `0x${string}`,
      });
      const ev = eventArgs<{ battleId: bigint }>(receipt, BATTLE_ARENA_ABI as any, 'QuickMatchStarted');
      if (ev) router.push(`/battle?id=${ev.battleId}`);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Quick match failed — opponent may not have quick-match enabled');
    } finally {
      setBusy(null);
    }
  }

  async function challenge(targetId: number) {
    if (!selected) return;
    setBusy(`challenge-${targetId}`);
    try {
      const receipt = await writeContract({
        address: ADDRESSES.battleArena,
        abi: BATTLE_ARENA_ABI as any,
        functionName: 'challenge',
        args: [BigInt(selected.token_id), BigInt(targetId)],
        value: parseEther(stake || '0'),
        account: address as `0x${string}`,
      });
      const ev = eventArgs<{ battleId: bigint }>(receipt, BATTLE_ARENA_ABI as any, 'ChallengeCreated');
      toast.success(`Challenge #${ev?.battleId ?? '?'} posted — share the ID; battle starts when they accept.`);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Challenge failed');
    } finally {
      setBusy(null);
    }
  }

  async function acceptChallenge() {
    setBusy('accept');
    try {
      const receipt = await writeContract({
        address: ADDRESSES.battleArena,
        abi: BATTLE_ARENA_ABI as any,
        functionName: 'accept',
        args: [BigInt(acceptId)],
        value: parseEther(acceptStake || '0'),
        account: address as `0x${string}`,
      });
      void receipt;
      router.push(`/battle?id=${acceptId}`);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Accept failed — check the battle ID and stake');
    } finally {
      setBusy(null);
    }
  }

  async function toggleQuickMatch(enabled: boolean) {
    if (!selected) return;
    try {
      await writeContract({
        address: ADDRESSES.battleArena,
        abi: BATTLE_ARENA_ABI as any,
        functionName: 'setQuickMatch',
        args: [BigInt(selected.token_id), enabled],
        account: address as `0x${string}`,
      });
      toast.success(enabled ? 'Quick match enabled — others can battle this agent instantly' : 'Quick match disabled');
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Failed');
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-muted-foreground">Connect your wallet to enter the arena.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">ARENA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          1v1 duels — free quick matches, or challenge with a BOT stake. Winner takes the pot.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">1 · Pick your fighter</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {myAgents.map((a) => (
            <AgentCard key={a.token_id} agent={a} compact selected={selected?.token_id === a.token_id} onClick={() => setSelected(a)} />
          ))}
        </div>
        {selected && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-2.5 text-sm">
            <Switch onCheckedChange={toggleQuickMatch} id="qm" />
            <label htmlFor="qm" className="text-muted-foreground">
              Let others quick-match <span className="text-foreground">{selected.name}</span> (zero stakes)
            </label>
          </div>
        )}
      </section>

      {selected && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground">2 · Choose an opponent (closest ELO)</h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Challenge stake</span>
              <Input value={stake} onChange={(e) => setStake(e.target.value)} className="h-8 w-24 bg-background/60 text-right" />
              <span className="text-muted-foreground">BOT</span>
            </div>
          </div>
          <div className="space-y-2">
            {opponents.map((o) => (
              <div key={o.token_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
                <div>
                  <span className="font-display font-bold">{o.name}</span>{' '}
                  <span className="text-xs text-muted-foreground">#{o.token_id} · L{o.level} · {o.ranking_points} ELO (±{o.elo_gap}) · {o.wins}W/{o.losses}L</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => quickMatch(o.token_id)}>
                    {busy === `quick-${o.token_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Zap className="mr-1 h-3.5 w-3.5" /> Quick match</>}
                  </Button>
                  <Button size="sm" disabled={!!busy} onClick={() => challenge(o.token_id)}>
                    {busy === `challenge-${o.token_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Swords className="mr-1 h-3.5 w-3.5" /> Challenge{Number(stake) > 0 ? ` ${stake} BOT` : ''}</>}
                  </Button>
                </div>
              </div>
            ))}
            {opponents.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No opponents yet.</p>}
          </div>
        </section>
      )}

      <Card className="border-border bg-card/60">
        <CardHeader><CardTitle className="font-display text-lg">Accept a challenge</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Battle ID</label>
            <Input value={acceptId} onChange={(e) => setAcceptId(e.target.value)} placeholder="42" className="w-28 bg-background/60" />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Matching stake (BOT)</label>
            <Input value={acceptStake} onChange={(e) => setAcceptStake(e.target.value)} placeholder="0" className="w-28 bg-background/60" />
          </div>
          <Button onClick={acceptChallenge} disabled={!acceptId || busy === 'accept'} className="font-display tracking-wider">
            {busy === 'accept' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Swords className="mr-2 h-4 w-4" />} ACCEPT & FIGHT
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
