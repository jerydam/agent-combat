'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  combatWsUrl, loadSettings, saveSettings, sfx, haptic,
  type CombatSettings, type ServerMsg, type StateMsg,
} from '@/lib/combat-client';
import { PERSONALITY_NAMES } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Settings, X, Swords, Shield } from 'lucide-react';
import { useLandscapeGameMode } from '@/lib/game-mode';

interface FloatingNum { id: number; slot: 0 | 1; text: string; cls: string }

export function CombatView() {
  const [settings, setSettings] = useState<CombatSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<'setup' | 'connecting' | 'countdown' | 'fight' | 'result'>('setup');
  const [countdown, setCountdown] = useState(3);
  const [state, setState] = useState<StateMsg | null>(null);
  const [result, setResult] = useState<{ winner: number; log: any } | null>(null);
  const [floats, setFloats] = useState<FloatingNum[]>([]);
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState<0 | 1 | null>(null);
  const [botPersonality, setBotPersonality] = useState(1);
  const [difficulty, setDifficulty] = useState(55);
  const { containerStyle, activate } = useLandscapeGameMode();
  const wsRef = useRef<WebSocket | null>(null);
  const holdStart = useRef<number>(0);
  const floatId = useRef(0);
  const vol = settings.sfx ? settings.masterVolume : 0;

  const update = (patch: Partial<CombatSettings>) =>
    setSettings((s) => { const next = { ...s, ...patch }; saveSettings(next); return next; });

  const addFloat = useCallback((slot: 0 | 1, text: string, cls: string) => {
    const id = ++floatId.current;
    setFloats((f) => [...f, { id, slot, text, cls }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 900);
  }, []);

  const handleEvents = useCallback((events: any[]) => {
    for (const e of events) {
      switch (e.kind) {
        case 'hit':
          (e.attack === 'heavy' ? sfx.heavy : e.crit ? sfx.crit : sfx.hit)(vol);
          if (settings.damageNumbers)
            addFloat(e.who === 0 ? 1 : 0, `-${e.dmg}${e.crit ? '!' : ''}`, e.crit ? 'text-amber-400 text-2xl' : 'text-rose-400');
          if (settings.screenShake) { setShake(true); setTimeout(() => setShake(false), 180); }
          setFlash(e.who === 0 ? 1 : 0); setTimeout(() => setFlash(null), 140);
          if (e.who === 1 && settings.haptics) haptic(e.attack === 'heavy' ? 60 : 30);
          break;
        case 'blocked':
          sfx.block(vol);
          if (settings.damageNumbers) addFloat(e.who as 0 | 1, `block -${e.dmg}`, 'text-sky-400 text-sm');
          break;
        case 'parry':
          sfx.parry(vol);
          addFloat(e.who as 0 | 1, 'PARRY!', 'text-emerald-300 text-2xl font-bold');
          if (e.who === 0 && settings.haptics) haptic([20, 40, 20]);
          break;
        case 'windup':
          if (e.who === 1) sfx.windup(vol); // hear the bot loading up
          break;
        case 'exhausted':
          sfx.exhausted(vol);
          addFloat(e.who as 0 | 1, 'EXHAUSTED', 'text-orange-400 text-sm');
          break;
        case 'ko':
          sfx.ko(vol);
          if (settings.haptics) haptic([80, 60, 120]);
          break;
      }
    }
  }, [vol, settings, addFloat]);

  const connect = useCallback(() => {
    activate(); // user gesture: fullscreen + landscape lock (or CSS rotate)
    setPhase('connecting');
    setResult(null);
    setState(null);
    const ws = new WebSocket(combatWsUrl({ personality: 0, power: 72, bot_personality: botPersonality, difficulty }));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg: ServerMsg = JSON.parse(ev.data);
      if (msg.kind === 'countdown') { setPhase('countdown'); setCountdown(msg.n); sfx.count(vol); }
      else if (msg.kind === 'fight') { setPhase('fight'); sfx.fight(vol); }
      else if (msg.kind === 'state') { setState(msg); if (msg.events.length) handleEvents(msg.events); }
      else if (msg.kind === 'result') { setResult(msg); setPhase('result'); }
    };
    ws.onerror = () => setPhase('setup');
    ws.onclose = () => { if (phase !== 'result') setPhase((p) => (p === 'result' ? p : 'setup')); };
  }, [botPersonality, difficulty, vol, handleEvents, phase, activate]);

  useEffect(() => () => wsRef.current?.close(), []);

  // ------------------------------------------------------------- inputs
  const attackDown = () => { holdStart.current = Date.now(); };
  const attackUp = () => {
    const heavy = Date.now() - holdStart.current >= 350;
    wsRef.current?.send(JSON.stringify({ type: 'attack', heavy }));
    if (settings.haptics) haptic(10);
  };
  const defend = () => {
    wsRef.current?.send(JSON.stringify({ type: 'defend' }));
    if (settings.haptics) haptic(10);
  };

  const me = state?.fighters[0];
  const bot = state?.fighters[1];
  const now = state?.t ?? 0;

  // ------------------------------------------------------------- render
  return (
    <div className={cn('z-50 select-none overflow-hidden bg-background', shake && 'animate-[shake_0.18s]')}
      style={{ ...containerStyle, touchAction: 'none' }}>
      <style>{`@keyframes shake{25%{transform:translate(-6px,2px)}50%{transform:translate(5px,-3px)}75%{transform:translate(-3px,1px)}}
        @keyframes floatUp{to{transform:translateY(-48px);opacity:0}}`}</style>

      {/* HUD: life + stamina */}
      {state && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3">
          {[{ f: me!, right: false }, { f: bot!, right: true }].map(({ f, right }, i) => (
            <div key={i} className={cn('flex-1 space-y-1', right && 'text-right')}>
              <div className={cn('flex items-baseline gap-2 text-xs font-display font-bold', right && 'flex-row-reverse')}>
                <span>{i === 0 ? 'YOU' : 'BOT'}</span>
                <span className="text-muted-foreground tabular-nums">{f.hp}/{f.max_hp}</span>
              </div>
              <div className={cn('h-3 overflow-hidden rounded bg-secondary', right && 'scale-x-[-1]')}>
                <div className={cn('h-full transition-all duration-200', i === 0 ? 'bg-primary' : 'bg-rose-500')}
                  style={{ width: `${(f.hp / f.max_hp) * 100}%` }} />
              </div>
              <div className={cn('h-1.5 overflow-hidden rounded bg-secondary/70', right && 'scale-x-[-1]')}>
                <div className={cn('h-full', now < f.exhausted_until ? 'bg-orange-500' : 'bg-amber-300/80')}
                  style={{ width: `${f.stamina}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {phase === 'fight' && state && (
        <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2 font-display text-lg font-bold tabular-nums text-muted-foreground">
          {Math.max(0, Math.ceil((90000 - now) / 1000))}
        </div>
      )}

      {/* fighters */}
      {state && (
        <div className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 items-center justify-around px-[12%]">
          {[{ f: me!, slot: 0 as const, glyph: '⚔', color: 'from-teal-500/40 to-cyan-500/10 ring-primary/60' },
            { f: bot!, slot: 1 as const, glyph: ['⚔', '🛡', '◈'][botPersonality], color: 'from-rose-500/40 to-orange-500/10 ring-rose-500/60' }].map(({ f, slot, glyph, color }) => {
            const winding = f.phase === 'windup';
            const windPct = winding ? Math.min(1, 1 - (f.phase_ends_at - now) / 500) : 0;
            const lunge = winding ? (slot === 0 ? windPct * 26 : -windPct * 26) : 0;
            return (
              <div key={slot} className="relative flex flex-col items-center">
                {floats.filter((x) => x.slot === slot).map((x) => (
                  <span key={x.id} className={cn('absolute -top-10 animate-[floatUp_0.9s_ease-out_forwards] font-display font-bold', x.cls)}>{x.text}</span>
                ))}
                <div
                  className={cn(
                    'flex h-28 w-28 items-center justify-center rounded-2xl bg-gradient-to-br text-6xl ring-4 transition-transform duration-100',
                    color,
                    flash === slot && 'brightness-[2.5]',
                    f.blocking && 'ring-sky-300 shadow-[0_0_30px_rgba(125,211,252,0.6)]',
                    now < f.staggered_until && 'rotate-12 opacity-70',
                    now < f.exhausted_until && 'saturate-0',
                    winding && f.attack_kind === 'heavy' && 'ring-amber-400',
                  )}
                  style={{ transform: `translateX(${lunge}px)` }}
                >
                  {f.blocking ? '🛡' : glyph}
                </div>
                {winding && (
                  <div className="mt-2 h-1 w-20 overflow-hidden rounded bg-secondary">
                    <div className={cn('h-full', f.attack_kind === 'heavy' ? 'bg-amber-400' : 'bg-foreground/70')} style={{ width: `${windPct * 100}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* countdown / overlays */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <span className="font-display text-8xl font-bold text-primary text-glow">{countdown}</span>
        </div>
      )}
      {phase === 'setup' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 p-6 text-center">
          <h1 className="font-display text-4xl font-bold tracking-widest">äGENT çOMBAT</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Tap to strike, hold for a heavy. Time your defend right before impact for a <span className="text-emerald-300">PARRY</span>. Watch your stamina — mashing gets you knocked out.
          </p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Opponent</span>
            {[0, 1, 2].map((p) => (
              <button key={p} onClick={() => setBotPersonality(p)}
                className={cn('rounded-lg border px-3 py-1.5', botPersonality === p ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>
                {PERSONALITY_NAMES[p as 0 | 1 | 2]}
              </button>
            ))}
          </div>
          <div className="flex w-64 items-center gap-3 text-sm">
            <span className="text-muted-foreground">Difficulty</span>
            <Slider value={[difficulty]} min={40} max={90} step={5} onValueChange={([v]) => setDifficulty(v)} />
            <span className="w-8 tabular-nums">{difficulty}</span>
          </div>
          <Button size="lg" onClick={connect} className="font-display text-lg tracking-widest">
            <Swords className="mr-2 h-5 w-5" /> FIGHT
          </Button>
        </div>
      )}
      {phase === 'connecting' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center text-muted-foreground">Entering the arena…</div>
      )}
      {phase === 'result' && result && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/90 p-6 text-center">
          <h2 className={cn('font-display text-5xl font-bold', result.winner === 0 ? 'text-primary text-glow' : 'text-destructive')}>
            {result.winner === 0 ? 'VICTORY' : 'DEFEATED'}
          </h2>
          {result.log?.fighters && (
            <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm">
              {result.log.fighters.map((f: any, i: number) => (
                <div key={i} className="space-y-0.5">
                  <div className="font-display font-bold">{i === 0 ? 'YOU' : 'BOT'} · {f.score} pts</div>
                  <div className="text-muted-foreground">{f.hits} hits · {f.defends} defends · {f.parries} parries</div>
                </div>
              ))}
            </div>
          )}
          <Button size="lg" onClick={connect} className="font-display tracking-widest">REMATCH</Button>
          <Button variant="ghost" onClick={() => setPhase('setup')}>Change opponent</Button>
        </div>
      )}

      {/* the two buttons */}
      {phase === 'fight' && (
        <>
          {[{ label: 'DEF', icon: Shield, side: settings.swapButtons ? 'right' : 'left', onDown: defend, onUp: undefined, cls: 'border-sky-400/60 text-sky-300 active:bg-sky-400/20' },
            { label: 'ATK', icon: Swords, side: settings.swapButtons ? 'left' : 'right', onDown: attackDown, onUp: attackUp, cls: 'border-primary/60 text-primary active:bg-primary/20' }].map((b) => (
            <button
              key={b.label}
              onPointerDown={(e) => { e.preventDefault(); b.onDown(); }}
              onPointerUp={(e) => { e.preventDefault(); b.onUp?.(); }}
              className={cn('absolute z-20 flex items-center justify-center rounded-full border-4 bg-card/40 font-display font-bold backdrop-blur-sm', b.cls)}
              style={{
                [b.side]: 28, bottom: settings.buttonRaise,
                width: settings.buttonSize, height: settings.buttonSize,
                opacity: settings.buttonOpacity,
              } as any}
            >
              <b.icon className="h-8 w-8" />
            </button>
          ))}
        </>
      )}

      {/* settings */}
      <button onClick={() => setShowSettings(true)} className="absolute right-3 top-16 z-20 rounded-full border border-border bg-card/60 p-2 text-muted-foreground">
        <Settings className="h-4 w-4" />
      </button>
      {showSettings && (
        <div className="absolute inset-y-0 right-0 z-40 w-80 space-y-5 overflow-y-auto border-l border-border bg-card/95 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold">SETTINGS</h3>
            <button onClick={() => setShowSettings(false)}><X className="h-5 w-5" /></button>
          </div>
          {[
            ['Swap buttons (ATK left)', settings.swapButtons, (v: boolean) => update({ swapButtons: v })],
            ['Sound effects', settings.sfx, (v: boolean) => update({ sfx: v })],
            ['Haptics', settings.haptics, (v: boolean) => update({ haptics: v })],
            ['Screen shake', settings.screenShake, (v: boolean) => update({ screenShake: v })],
            ['Damage numbers', settings.damageNumbers, (v: boolean) => update({ damageNumbers: v })],
          ].map(([label, val, fn]: any) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <span>{label}</span><Switch checked={val} onCheckedChange={fn} />
            </div>
          ))}
          {[
            ['Volume', settings.masterVolume * 100, 0, 100, (v: number) => update({ masterVolume: v / 100 })],
            ['Button size', settings.buttonSize, 64, 140, (v: number) => update({ buttonSize: v })],
            ['Button opacity', settings.buttonOpacity * 100, 30, 100, (v: number) => update({ buttonOpacity: v / 100 })],
            ['Button height', settings.buttonRaise, 8, 120, (v: number) => update({ buttonRaise: v })],
          ].map(([label, val, min, max, fn]: any) => (
            <div key={label} className="space-y-1.5 text-sm">
              <span>{label}</span>
              <Slider value={[val]} min={min} max={max} onValueChange={([v]) => fn(v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
