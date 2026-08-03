'use client';

import { cn } from '@/lib/utils';
import type { FighterSnap } from '@/lib/combat-client';
import { Check, ChevronRight, Shield, Swords, Flame, Gauge } from 'lucide-react';

/**
 * The training curriculum.
 *
 * This is a REAL fight — the same server, engine and controls as ranked
 * combat, against a deliberately weak bot. Nothing here is simulated or
 * scripted: each lesson watches the live event stream and only advances
 * when the player genuinely performs the move. That's the point; a
 * tutorial that just shows text teaches nothing about a 150ms parry
 * window.
 */

export type Highlight = 'atk' | 'atk-hold' | 'def' | 'super' | null;

export interface Lesson {
  id: string;
  title: string;
  /** the imperative — what to physically do, right now */
  instruction: string;
  /** why it matters / what the move actually does */
  detail: string;
  /** which on-screen control to pulse */
  highlight: Highlight;
  icon: React.ElementType;
  /** how many successes to advance */
  need: number;
  /** does this event count as a success? `me` is the player's snapshot. */
  match: (e: any, me?: FighterSnap) => boolean;
  /** optional passive completion (e.g. observing your own stamina drop) */
  observe?: (me: FighterSnap) => boolean;
  /** seconds after which we advance anyway, so nobody gets stuck */
  autoAdvanceMs?: number;
}

/** Player is always slot 0; `who` on an event is the actor. */
const mine = (e: any) => e.who === 0;

export const LESSONS: Lesson[] = [
  {
    id: 'light',
    title: 'Light attack',
    instruction: 'TAP the ATK button.',
    detail:
      'A quick jab. Short wind-up, small damage, cheap on stamina. This is your bread and butter — it lands before most opponents can react.',
    highlight: 'atk',
    icon: Swords,
    need: 2,
    // count the swing itself: a blocked jab still taught the input
    match: (e) => mine(e) && e.kind === 'windup' && e.attack === 'light',
  },
  {
    id: 'heavy',
    title: 'Heavy attack',
    instruction: 'HOLD ATK for about half a second, then release.',
    detail:
      'Roughly double the damage, but a much longer wind-up — the enemy can see it coming and block or parry it. Use it when they are staggered, exhausted, or recovering.',
    highlight: 'atk-hold',
    icon: Swords,
    need: 1,
    match: (e) => mine(e) && e.kind === 'windup' && e.attack === 'heavy',
  },
  {
    id: 'block',
    title: 'Blocking',
    instruction: 'Watch the enemy wind up, then TAP DEF before their hit lands.',
    detail:
      'Blocking soaks up to ~75% of an incoming hit. Your guard only stays up for a moment, and spamming it shrinks the window — time it, do not hold it.',
    highlight: 'def',
    icon: Shield,
    need: 1,
    // `blocked` fires with who = the DEFENDER
    match: (e) => mine(e) && e.kind === 'blocked',
  },
  {
    id: 'parry',
    title: 'Parry',
    instruction: 'Tap DEF at the LAST moment — just as their strike connects.',
    detail:
      'Block in the final 150ms and you parry instead: zero damage, the attacker is staggered, and you get a free hit. It is the highest-value move in the game and the hardest to time.',
    highlight: 'def',
    icon: Shield,
    need: 1,
    match: (e) => mine(e) && e.kind === 'parry',
  },
  {
    id: 'stamina',
    title: 'Stamina',
    instruction: 'Keep attacking and watch your thin yellow bar drain.',
    detail:
      'Every action costs stamina. Empty it and you are EXHAUSTED — you cannot act, you take 25% more damage, and your guard is halved. Pace yourself; do not mash.',
    highlight: null,
    icon: Gauge,
    need: 1,
    match: (e) => mine(e) && e.kind === 'exhausted',
    // most players never fully gas out, so accept "visibly drained" too
    observe: (me) => me.stamina <= 45,
    autoAdvanceMs: 25_000,
  },
  {
    id: 'super',
    title: 'Super',
    instruction: 'Land hits to charge the orange bar, then hit SUPER.',
    detail:
      'Landing and taking damage charges your special. At full, a third button appears: a huge strike that beats a normal guard. It winds up slowly though — a sharp opponent can still block it, and a perfect parry cancels it completely.',
    highlight: 'super',
    icon: Flame,
    need: 1,
    match: (e) => mine(e) && e.kind === 'super_start',
    autoAdvanceMs: 60_000,
  },
];

/**
 * Live coaching state, pushed by the server.
 *
 * The server drives this, not the client: it owns the clock, so it is the
 * only thing that can freeze the fight at the exact moment a lesson makes
 * sense. The client just renders what it is told and lights up a button.
 */
export interface TutorialState {
  index: number;
  total: number;
  done: boolean;
  id: string | null;
  title: string | null;
  text: string | null;
  highlight: Highlight;
}

/** The coaching card. Deliberately compact — it must not cover the fight. */
export function TutorialCoach({
  state, paused, onFinish,
}: {
  state: TutorialState;
  paused: boolean;
  onFinish: () => void;
}) {
  if (state.done) {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-14 z-30 w-[min(92%,30rem)] -translate-x-1/2 rounded-xl border-2 border-success bg-background/95 p-4 text-center backdrop-blur">
        <div className="font-pixel pixel-text text-sm text-success">TRAINING COMPLETE</div>
        <p className="mt-2 text-xs text-muted-foreground">
          You know every control in the game. Ranked fights earn points, XP and — if
          you stake — BOT.
        </p>
        <button onClick={onFinish}
          className="mt-3 rounded-lg border border-success/60 bg-success/15 px-4 py-1.5 font-display text-xs font-bold tracking-widest text-success">
          FINISH
        </button>
      </div>
    );
  }

  if (!state.title) return null;
  const Icon = LESSONS.find((l) => l.id === state.id)?.icon ?? Swords;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-30 flex justify-center px-3">
      <div className={cn(
        'w-[min(94%,32rem)] rounded-xl border bg-background/95 p-3 backdrop-blur transition-colors',
        paused ? 'border-warning shadow-[0_0_28px_hsl(42_100%_55%/0.35)]' : 'border-primary/60',
      )}>
        {/* progress pips: where you are in the curriculum */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: state.total }).map((_, i) => (
            <span key={i}
              className={cn('h-1 flex-1 rounded-full',
                i < state.index ? 'bg-success'
                  : i === state.index ? 'bg-primary' : 'bg-border')} />
          ))}
        </div>

        <div className="mt-2 flex items-start gap-2.5">
          <div className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
            paused ? 'border-warning/60 bg-warning/15 text-warning'
              : 'border-primary/50 bg-primary/10 text-primary',
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={cn('font-display text-xs font-bold tracking-widest',
                paused ? 'text-warning' : 'text-primary')}>
                {state.title.toUpperCase()}
              </span>
              <span className="font-display text-[10px] text-muted-foreground">
                {state.index + 1}/{state.total}
              </span>
              {paused && (
                <span className="animate-px-blink font-pixel pixel-text text-[8px] text-warning">
                  ⏸ PAUSED
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold leading-snug">{state.text}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small tick shown on a lesson the moment it is satisfied. */
export function LessonTick() {
  return (
    <span className="flex items-center gap-1 text-xs text-success">
      <Check className="h-3.5 w-3.5" /> done
    </span>
  );
}
