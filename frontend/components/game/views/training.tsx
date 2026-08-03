'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import type { Agent, BattleLog, MatchmakingEntry } from '@/lib/types';
import { LESSONS } from '@/components/game/tutorial';
import { AgentCard } from '@/components/game/agent-card';
import { BattleReplay } from '@/components/game/battle-replay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dumbbell, Loader2, Play, Swords } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Training has two halves:
 *
 * 1. THE DOJO — a real, live fight against a weak bot with a coaching
 *    overlay that names the button, says when to press it, and only
 *    advances once you actually land the move. It runs on the real
 *    engine at /training/fight, so what you learn is what you'll use.
 * 2. SPARRING — the old simulated matchup preview, kept because it
 *    answers a different question: "would this agent beat that one?"
 */
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-wide text-steel sm:text-3xl">TRAINING</h1>
        <div className="split-line mt-2 w-32" />
        <p className="mt-1 text-sm text-muted-foreground">
          Learn the controls in a real fight, or simulate a matchup before you stake.
        </p>
      </div>

      {/* ------------------------------------------------------- the dojo */}
      <div className="overflow-hidden rounded-2xl border border-primary/40 bg-card/50">
        <div className="bg-vs-split px-5 py-6">
          <div className="flex items-center gap-2 font-display text-xs tracking-[0.3em] text-primary">
            <Dumbbell className="h-4 w-4" /> THE DOJO
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold text-steel">
            Learn to fight, for real
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            A live fight against a deliberately weak sparring bot — the same engine and
            the same controls as ranked combat. Each step tells you which button to press
            and what the move actually does, and only completes when you pull it off.
            Nothing you do here touches your record, XP or points.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LESSONS.map((l, i) => {
              const Icon = l.icon;
              return (
                <div key={l.id}
                  className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-background/50 p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-xs font-bold">
                      <span className="text-muted-foreground">{i + 1}.</span> {l.title}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {l.instruction}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <Link href="/training/fight" className="mt-5 inline-block">
            <Button size="lg" className="animate-pulse-glow font-display tracking-widest">
              <Play className="mr-2 h-5 w-5" /> START TRAINING
            </Button>
          </Link>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Opens the arena in landscape — turn your phone sideways.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------- sparring */}
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-steel">
          <Swords className="h-4 w-4" /> MATCHUP SPARRING
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulated, not played — runs the fight with a fresh random seed so you can see
          how two agents stack up. No gas, no XP, no records.
        </p>

        {!connected ? (
          <div className="mt-4 flex flex-col items-center gap-4 rounded-xl border border-border bg-card/40 py-12">
            <p className="text-sm text-muted-foreground">Connect your wallet to spar with your agents.</p>
            <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myAgents.map((a) => (
                <AgentCard key={a.token_id} agent={a} compact
                  selected={selected?.token_id === a.token_id}
                  onClick={() => setSelected(a)} />
              ))}
            </div>

            {selected && (
              <div className="mt-4 flex flex-wrap gap-2">
                {opponents.map((o) => (
                  <Button key={o.token_id} size="sm" variant="outline" disabled={running}
                    onClick={() => spar(o.token_id)}>
                    <Dumbbell className="mr-1.5 h-3.5 w-3.5" /> Spar {o.name} (#{o.token_id})
                  </Button>
                ))}
              </div>
            )}

            {running && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}

            {log && (
              <Card className="mt-4 border-border bg-card/60">
                <CardHeader>
                  <CardTitle className="font-display text-sm uppercase tracking-widest text-muted-foreground">
                    Sparring session
                  </CardTitle>
                </CardHeader>
                <CardContent><BattleReplay log={log} /></CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
