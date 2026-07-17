'use client';

import { cn } from '@/lib/utils';
import { PERSONALITY_NAMES, TIER_NAMES, type PersonalityId } from '@/lib/types';

const TIER_RING: Record<number, string> = {
  1: 'ring-slate-500/40 shadow-[0_0_12px_rgba(148,163,184,0.25)]',
  2: 'ring-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.4)]',
  3: 'ring-amber-400/60 shadow-[0_0_26px_rgba(251,191,36,0.5)]',
};

const PERSONALITY_GLYPH: Record<PersonalityId, string> = {
  0: '⚔',
  1: '🛡',
  2: '◈',
};

const PERSONALITY_GRADIENT: Record<PersonalityId, string> = {
  0: 'from-rose-500/30 via-orange-500/20 to-amber-500/10',
  1: 'from-sky-500/30 via-cyan-500/20 to-teal-500/10',
  2: 'from-emerald-500/30 via-teal-500/20 to-cyan-500/10',
};

interface AgentAvatarProps {
  personality: PersonalityId;
  tier?: number;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animate?: boolean;
}

const SIZES = {
  sm: 'h-12 w-12 text-2xl',
  md: 'h-20 w-20 text-4xl',
  lg: 'h-28 w-28 text-6xl',
  xl: 'h-40 w-40 text-8xl',
};

export function AgentAvatar({ personality, tier = 1, name, size = 'md', animate }: AgentAvatarProps) {
  return (
    <div
      title={`${name} — ${PERSONALITY_NAMES[personality]} · ${TIER_NAMES[tier] ?? 'Basic'}`}
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ring-2',
        SIZES[size],
        PERSONALITY_GRADIENT[personality] ?? PERSONALITY_GRADIENT[0],
        TIER_RING[tier] ?? TIER_RING[1],
        animate && 'animate-pulse',
      )}
    >
      <span className="select-none drop-shadow">{PERSONALITY_GLYPH[personality] ?? '⚔'}</span>
    </div>
  );
}
