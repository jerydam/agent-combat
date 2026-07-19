'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PERSONALITY_NAMES, TIER_NAMES, type Agent, type Battle } from '@/lib/types';
import { AgentAvatar } from '@/components/game/agent-avatar';
import { StatBar } from '@/components/game/stat-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { shortAddr } from '@/lib/wallet';

export function AgentDetailView({ tokenId }: { tokenId: number }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [battles, setBattles] = useState<Battle[]>([]);

  useEffect(() => {
    api.agent(tokenId).then(setAgent).catch(() => {});
    api.battles(tokenId).then(setBattles).catch(() => {});
  }, [tokenId]);

  if (!agent) return <Skeleton className="mx-auto h-96 max-w-3xl rounded-xl" />;

  const xpIntoLevel = agent.experience % 500;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="border-border bg-card/60">
        <CardContent className="flex flex-wrap items-center gap-6 pt-6">
          <AgentAvatar personality={agent.personality} tier={agent.tier ?? 1} name={agent.name} size="xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="font-display text-3xl font-bold">{agent.name} <span className="text-lg font-normal text-muted-foreground">#{agent.token_id}</span></h1>
            <div className="split-line mt-2 w-32" />
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{PERSONALITY_NAMES[agent.personality]}</Badge>
              <Badge variant="outline">{TIER_NAMES[agent.tier ?? 1]}</Badge>
              <Badge variant="outline">Level {agent.level}</Badge>
              <Badge variant="outline">{agent.ranking_points} ELO</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Owner {shortAddr(agent.owner)} · {agent.wins}W / {agent.losses}L</p>
            <div className="max-w-xs">
              <StatBar label={`XP → next level`} value={xpIntoLevel} max={500} />
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-x-6 gap-y-3 sm:w-64">
            <StatBar label="ATK" value={agent.attack} color="bg-rose-500" />
            <StatBar label="DEF" value={agent.defense} color="bg-sky-500" />
            <StatBar label="SPD" value={agent.speed} color="bg-amber-500" />
            <StatBar label="INT" value={agent.intelligence} color="bg-emerald-500" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card/60">
        <CardHeader><CardTitle className="font-display text-lg">Battle history</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {battles.map((b) => {
            const won = b.winner_agent === tokenId;
            return (
              <Link key={b.battle_id} href={`/battle?id=${b.battle_id}`} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-4 py-2.5 text-sm transition-colors hover:border-primary/40">
                <span className="text-muted-foreground">Battle #{b.battle_id} · #{b.agent_a} vs #{b.agent_b}</span>
                <span className={won ? 'font-semibold text-success' : 'font-semibold text-destructive'}>
                  {b.status === 'resolved' ? (won ? 'VICTORY' : 'DEFEAT') : b.status.toUpperCase()}
                </span>
              </Link>
            );
          })}
          {battles.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No battles yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}