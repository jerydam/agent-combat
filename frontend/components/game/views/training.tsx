'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import type { Agent, BattleLog, MatchmakingEntry } from '@/lib/types';
import { AgentCard } from '@/components/game/agent-card';
import { BattleReplay } from '@/components/game/battle-replay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dumbbell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/** Free sparring — the backend's /preview endpoint. No chain, no XP:
 *  pure matchup testing before you stake anything. */
export function TrainingView() {
  const { address, connected, connect } = useWallet();
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [opponents, setOpponents] = useState<MatchmakingEntry[]>([]);
  const [log, setLog] = useState<BattleLog | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!connected) return;
    api.agents(address).then(setMyAgents).catch(() => {});
  }, [connected, address]);

  useEffect(() => {
    if (!selected) return;
    api.matchmaking(selected.token_id).then(setOpponents).catch(() => setOpponents([]));
  }, [selected]);

  async function spar(opponentId: number) {
    if (!selected) return;
    setRunning(true);
    setLog(null);
    try {
      const seed = Math.floor(Math.random() * 1_000_000_000);
      setLog(await api.preview(selected.token_id, opponentId, seed));
    } catch (e: any) {
      toast.error(e?.message ?? 'Sparring failed');
    } finally {
      setRunning(false);
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-muted-foreground">Connect your wallet to train.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide text-steel">TRAINING</h1>
          <div className="split-line mt-2 w-32" />
        <p className="mt-1 text-sm text-muted-foreground">
          Free sparring — test matchups with fresh random seeds. No gas, no XP, no records.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {myAgents.map((a) => (
          <AgentCard key={a.token_id} agent={a} compact selected={selected?.token_id === a.token_id} onClick={() => setSelected(a)} />
        ))}
      </div>

      {selected && (
        <div className="flex flex-wrap gap-2">
          {opponents.map((o) => (
            <Button key={o.token_id} size="sm" variant="outline" disabled={running} onClick={() => spar(o.token_id)}>
              <Dumbbell className="mr-1.5 h-3.5 w-3.5" /> Spar {o.name} (#{o.token_id})
            </Button>
          ))}
        </div>
      )}

      {running && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}

      {log && (
        <Card className="border-border bg-card/60">
          <CardHeader><CardTitle className="font-display text-sm uppercase tracking-widest text-muted-foreground">Sparring session</CardTitle></CardHeader>
          <CardContent><BattleReplay log={log} /></CardContent>
        </Card>
      )}
    </div>
  );
}