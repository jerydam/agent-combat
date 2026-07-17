'use client';

import { useEffect, useState } from 'react';
import { parseEther } from 'viem';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import { writeContract } from '@/lib/tx';
import { ADDRESSES, TOURNAMENT_ABI } from '@/lib/contracts';
import type { Agent, TournamentInfo } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Medal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function TournamentsView() {
  const { address, connected, connect } = useWallet();
  const [tournaments, setTournaments] = useState<TournamentInfo[]>([]);
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [enterId, setEnterId] = useState('');
  const [enterFee, setEnterFee] = useState('0');
  const [enterAgent, setEnterAgent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.tournaments().then(setTournaments).catch(() => {});
  }, []);
  useEffect(() => {
    if (!connected) return;
    api.agents(address).then(setMyAgents).catch(() => {});
  }, [connected, address]);

  async function enter() {
    if (!connected) return connect();
    if (!enterId || !enterAgent) return toast.error('Tournament ID and agent required');
    setBusy(true);
    try {
      await writeContract({
        address: ADDRESSES.tournament,
        abi: TOURNAMENT_ABI as any,
        functionName: 'enter',
        args: [BigInt(enterId), BigInt(enterAgent)],
        value: parseEther(enterFee || '0'),
        account: address as `0x${string}`,
      });
      toast.success(`Entered tournament #${enterId} — bracket runs automatically after registration closes`);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Entry failed — check ID and entry fee');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">TOURNAMENTS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Single-elimination brackets, prize pool on-chain, podium 50/30/20. The whole bracket derives from an on-chain seed — fully replayable.
        </p>
      </div>

      <Card className="max-w-xl border-border bg-card/60">
        <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Medal className="h-4 w-4 text-primary" /> Enter a tournament</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">ID</label>
            <Input value={enterId} onChange={(e) => setEnterId(e.target.value)} placeholder="1" className="bg-background/60" /></div>
          <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Fee (BOT)</label>
            <Input value={enterFee} onChange={(e) => setEnterFee(e.target.value)} className="bg-background/60" /></div>
          <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Agent</label>
            <Select value={enterAgent} onValueChange={setEnterAgent}>
              <SelectTrigger className="bg-background/60"><SelectValue placeholder="Pick" /></SelectTrigger>
              <SelectContent>
                {myAgents.map((a) => (
                  <SelectItem key={a.token_id} value={String(a.token_id)}>{a.name} (#{a.token_id})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={enter} disabled={busy} className="col-span-3 font-display tracking-wider">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Medal className="mr-2 h-4 w-4" />} ENTER
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Results</h2>
        <div className="space-y-2">
          {tournaments.map((t) => (
            <div key={t.tournament_id} className="rounded-xl border border-border bg-card/50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display font-bold">Tournament #{t.tournament_id}</span>
                <span className="text-xs uppercase text-muted-foreground">{t.status} · {t.entrants.length} entrants</span>
              </div>
              {t.podium?.first != null && (
                <div className="mt-2 flex gap-4 text-sm">
                  <span className="text-amber-400">🥇 #{t.podium.first}</span>
                  <span className="text-slate-300">🥈 #{t.podium.second}</span>
                  <span className="text-orange-400">🥉 #{t.podium.third}</span>
                </div>
              )}
            </div>
          ))}
          {tournaments.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No tournaments resolved yet.</p>}
        </div>
      </section>
    </div>
  );
}
