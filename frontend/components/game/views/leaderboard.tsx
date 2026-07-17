'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PERSONALITY_NAMES, TIER_NAMES, type Agent } from '@/lib/types';
import { AgentAvatar } from '@/components/game/agent-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Trophy } from 'lucide-react';

export function LeaderboardView() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    api.leaderboard().then(setAgents).catch(() => setAgents([]));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">LEADERBOARD</h1>
        <p className="mt-1 text-sm text-muted-foreground">ELO ranking · everyone starts at 1000</p>
      </div>

      {agents === null ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-2">
          {agents.map((a, i) => (
            <Link
              key={a.token_id}
              href={`/agents/${a.token_id}`}
              className={cn(
                'flex items-center gap-4 rounded-xl border bg-card/50 px-4 py-3 transition-colors hover:border-primary/50',
                i === 0 && 'border-amber-400/50 shadow-[0_0_20px_rgba(251,191,36,0.15)]',
                i > 0 && 'border-border',
              )}
            >
              <div className={cn('w-8 text-center font-display text-lg font-bold', i === 0 ? 'text-amber-400' : i < 3 ? 'text-primary' : 'text-muted-foreground')}>
                {i === 0 ? <Trophy className="mx-auto h-5 w-5" /> : i + 1}
              </div>
              <AgentAvatar personality={a.personality} tier={a.tier ?? 1} name={a.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display font-bold">{a.name} <span className="text-xs font-normal text-muted-foreground">#{a.token_id}</span></div>
                <div className="text-xs text-muted-foreground">
                  L{a.level} · {PERSONALITY_NAMES[a.personality]} · {TIER_NAMES[a.tier ?? 1]}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-lg font-bold text-primary">{a.ranking_points}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.wins}W · {a.losses}L</div>
              </div>
            </Link>
          ))}
          {agents.length === 0 && <p className="py-16 text-center text-muted-foreground">No ranked agents yet.</p>}
        </div>
      )}
    </div>
  );
}
