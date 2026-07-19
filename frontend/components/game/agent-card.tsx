'use client';

import { cn } from '@/lib/utils';
import { PERSONALITY_NAMES, TIER_NAMES, type Agent } from '@/lib/types';
import { AgentAvatar } from './agent-avatar';
import { StatBar } from './stat-bar';
import { Badge } from '@/components/ui/badge';

const TIER_BADGE: Record<number, string> = {
  1: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  2: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  3: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

interface AgentCardProps {
  agent: Agent;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
  footer?: React.ReactNode;
}

export function AgentCard({ agent, onClick, selected, compact, footer }: AgentCardProps) {
  const total = agent.wins + agent.losses;
  const winRate = total > 0 ? Math.round((agent.wins / total) * 100) : 0;
  const tier = agent.tier ?? 1;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card/60 p-4 transition-all duration-300',
        onClick && 'cursor-pointer hover:border-primary/50 hover:bg-card/80 hover:shadow-[0_0_24px_hsl(204_95%_53%/0.2)]',
        selected && 'border-primary ring-2 ring-primary/40 shadow-[0_0_28px_hsl(204_95%_53%/0.4)]',
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100 opacity-0" />

      <div className="flex items-start gap-3">
        <AgentAvatar
          personality={agent.personality}
          tier={tier}
          name={agent.name}
          size={compact ? 'sm' : 'md'}
          skin={agent.skin}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-bold text-foreground">
            {agent.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="border-border text-[10px] uppercase tracking-wide">
              #{agent.token_id}
            </Badge>
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', TIER_BADGE[tier])}>
              {TIER_NAMES[tier]}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {PERSONALITY_NAMES[agent.personality]} • {agent.ranking_points} ELO
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-primary text-glow">L{agent.level}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Level</div>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          <StatBar label="ATK" value={agent.attack} color="bg-rose-500" compact />
          <StatBar label="DEF" value={agent.defense} color="bg-sky-500" compact />
          <StatBar label="SPD" value={agent.speed} color="bg-amber-500" compact />
          <StatBar label="INT" value={agent.intelligence} color="bg-emerald-500" compact />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-success">▲ {agent.wins}W</span>
          <span className="text-destructive">▼ {agent.losses}L</span>
          {total > 0 && <span className="text-muted-foreground">{winRate}%</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">XP</span>
          <span className="font-semibold text-foreground">{agent.experience}</span>
        </div>
      </div>

      {footer && <div className="mt-3 border-t border-border pt-3">{footer}</div>}
    </div>
  );
}