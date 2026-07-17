'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { BattleLog } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Swords, FastForward, RotateCcw } from 'lucide-react';

const MOVE_LABEL: Record<string, string> = {
  strike: 'Strike',
  power_strike: 'Power Strike',
  guard: 'Guard',
  analyze: 'Analyze',
  finisher: 'FINISHER',
};

/** Replays a deterministic battle log round by round with HP bars. */
export function BattleReplay({ log, onDone }: { log: BattleLog; onDone?: () => void }) {
  const { agent_a: a, agent_b: b } = log;
  const [cursor, setCursor] = useState(0); // rounds revealed
  const [playing, setPlaying] = useState(true);

  const hpAt = useMemo(() => {
    // HP after each revealed round, walked from the event stream
    let hpA = a.max_hp;
    let hpB = b.max_hp;
    const frames: { a: number; b: number }[] = [{ a: hpA, b: hpB }];
    for (const round of log.rounds) {
      for (const ev of round.events) {
        if (ev.target_hp != null) {
          if (ev.agent === a.token_id) hpB = ev.target_hp;
          else hpA = ev.target_hp;
        }
        if (ev.countered != null && ev.attacker_hp != null) {
          if (ev.agent === a.token_id) hpA = ev.attacker_hp;
          else hpB = ev.attacker_hp;
        }
      }
      frames.push({ a: hpA, b: hpB });
    }
    return frames;
  }, [log, a, b]);

  useEffect(() => {
    if (!playing || cursor >= log.rounds.length) return;
    const t = setTimeout(() => setCursor((c) => c + 1), 900);
    return () => clearTimeout(t);
  }, [playing, cursor, log.rounds.length]);

  useEffect(() => {
    if (cursor >= log.rounds.length) onDone?.();
  }, [cursor, log.rounds.length, onDone]);

  const finished = cursor >= log.rounds.length;
  const hp = hpAt[Math.min(cursor, hpAt.length - 1)];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {[{ f: a, hp: hp.a, side: 'left' }, { f: b, hp: hp.b, side: 'right' }].map(
          ({ f, hp: cur, side }, i) => (
            <div key={f.token_id} className={cn('space-y-1.5', side === 'right' && 'order-3')}>
              <div className={cn('flex items-baseline justify-between gap-2', side === 'right' && 'flex-row-reverse')}>
                <span className={cn('font-display font-bold', finished && log.winner === f.token_id && 'text-primary text-glow')}>
                  {f.name} <span className="text-muted-foreground">#{f.token_id}</span>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {cur}/{f.max_hp} HP
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn('h-full rounded-full transition-all duration-700 ease-out', i === 0 ? 'bg-primary' : 'bg-rose-500')}
                  style={{ width: `${(cur / f.max_hp) * 100}%` }}
                />
              </div>
            </div>
          ),
        )}
        <div className="order-2 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/60">
          <Swords className="h-4 w-4 text-primary" />
        </div>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border bg-background/40 p-3 font-mono text-xs">
        {log.rounds.slice(0, cursor).map((round) => (
          <div key={round.round}>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              Round {round.round}
            </div>
            {round.events.map((ev, i) => {
              const actor = ev.agent === a.token_id ? a.name : b.name;
              const target = ev.agent === a.token_id ? b.name : a.name;
              return (
                <div key={i} className="pl-2 text-muted-foreground">
                  <span className={cn(ev.agent === a.token_id ? 'text-primary' : 'text-rose-400')}>{actor}</span>{' '}
                  {ev.move === 'guard' && <>raises guard 🛡</>}
                  {ev.move === 'analyze' && <>analyzes {target} ◈ (+focus)</>}
                  {ev.move !== 'guard' && ev.move !== 'analyze' && (
                    ev.hit === false ? (
                      <>uses {MOVE_LABEL[ev.move] ?? ev.move} — MISS</>
                    ) : (
                      <>
                        uses <span className={cn(ev.move === 'finisher' && 'text-amber-400 font-bold')}>{MOVE_LABEL[ev.move] ?? ev.move}</span>
                        {' '}→ <span className="text-foreground">{ev.damage} dmg</span>
                        {ev.crit && <span className="text-amber-400"> CRIT!</span>}
                        {ev.countered != null && <span className="text-sky-400"> (countered {ev.countered})</span>}
                      </>
                    )
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {finished && (
          <div className="mt-2 border-t border-border pt-2 text-center font-display text-sm font-bold text-primary text-glow">
            {(log.winner === a.token_id ? a.name : b.name).toUpperCase()} WINS in {log.total_rounds} rounds
          </div>
        )}
      </div>

      <div className="flex justify-center gap-2">
        {!finished ? (
          <Button size="sm" variant="outline" onClick={() => setCursor(log.rounds.length)}>
            <FastForward className="mr-1.5 h-3.5 w-3.5" /> Skip
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => { setCursor(0); setPlaying(true); }}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Replay
          </Button>
        )}
      </div>
    </div>
  );
}
