'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  combatWsUrl, loadSettings, saveSettings, sfx, haptic,
  type CombatSettings, type RewardInfo, type ServerMsg, type StakeInfo, type StateMsg,
} from '@/lib/combat-client';
import { writeContract, eventArgs } from '@/lib/tx';
import { ADDRESSES, SOLO_ARENA_ABI } from '@/lib/contracts';
import { formatEther, parseEther } from 'viem';
import { toast } from 'sonner';
import { PERSONALITY_NAMES, type Agent } from '@/lib/types';
import { AVATARS } from '@/lib/avatars';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import Link from 'next/link';
import { Settings, X, Swords, Shield, Star, ChevronUp, Coins, Loader2, Flame, ArrowRight } from 'lucide-react';
import { useLandscapeGameMode } from '@/lib/game-mode';
import { PixelFx, type PixelFxHandle } from '@/components/game/pixel-fx';

interface FloatingNum { id: number; slot: 0 | 1; text: string; cls: string }

/** Mirrors TUNING["super_windup_ms"] in backend/app/combat/engine.py. */
const SUPER_WINDUP_MS = 900;

/**
 * Centre of `el` in `root`'s LOCAL coordinate space.
 *
 * Deliberately walks offsetParent instead of using getBoundingClientRect:
 * on iOS the whole arena is CSS-rotated 90deg, and client rects are
 * reported in the rotated *screen* frame. Offsets are pure layout values,
 * unaffected by any ancestor transform, so particles land on the sprite
 * in both the rotated and native-landscape cases.
 */
function localCentre(el: HTMLElement | null, root: HTMLElement | null) {
  if (!el || !root) return null;
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (!node) return null; // el isn't inside root — don't guess
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

/**
 * On iOS (and anywhere screen.orientation.lock is unsupported), the
 * arena is faked into landscape with a CSS rotate(90deg) transform
 * while the phone is physically portrait. The native OS number pad is
 * an overlay the browser controls — it renders upright in the real,
 * portrait orientation and has no idea the page content is rotated, so
 * it shows up sideways/disconnected from the input. CSS can't fix that;
 * only NOT summoning the native keyboard can. This in-app keypad
 * renders inside the already-rotated container, so it appears correctly
 * oriented like everything else on screen.
 */
function StakeKeypad({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) {
  const press = (k: string) => {
    if (k === 'back') return onChange(value.slice(0, -1));
    if (k === 'clear') return onChange('');
    if (k === '.' && value.includes('.')) return;
    onChange(value + k);
  };
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-72 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-xs tracking-widest text-muted-foreground">STAKE (BOT)</span>
          <button onClick={onClose} className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 rounded-lg border border-border bg-input px-3 py-2 text-right font-display text-2xl tabular-nums">
          {value || '0'}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
            <button key={k} onClick={() => press(k)}
              className="rounded-lg border border-border bg-secondary/50 py-3 font-display text-lg active:bg-secondary">
              {k === 'back' ? '⌫' : k}
            </button>
          ))}
        </div>
        <Button className="mt-3 w-full font-display" onClick={onClose}>DONE</Button>
      </div>
    </div>
  );
}

const WIN_REASON_TEXT: Record<string, [string, string]> = {
  ko:       ['KNOCKOUT', 'You dropped your opponent to 0 HP — a KO ends the fight instantly, whatever the score.'],
  score:    ['ON POINTS', 'Time ran out — higher score (damage + defends + parries) takes it.'],
  hp:       ['ON HEALTH', 'Scores were level at the bell — more HP remaining takes it.'],
  tiebreak: ['TIEBREAK', 'Dead even at the bell — decided on speed.'],
};

function FighterSprite({ src, glyph, flip }: { src?: string; glyph: string; flip?: boolean }) {
  if (src) {
    return (
      // `pixelated` is what turns the avatar art into a sprite: the
      // browser nearest-neighbours it up instead of smoothing it.
      <img src={src} alt="" draggable={false}
        className={cn('pixelated h-full w-full object-contain drop-shadow-lg', flip && 'scale-x-[-1]')} />
    );
  }
  return <span className={cn(flip && 'scale-x-[-1] inline-block')}>{glyph}</span>;
}

export function CombatView() {
  const { address, connected } = useWallet();
  const [settings, setSettings] = useState<CombatSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<'setup' | 'connecting' | 'countdown' | 'fight' | 'result'>('setup');
  const [countdown, setCountdown] = useState(3);
  const [state, setState] = useState<StateMsg | null>(null);
  const [result, setResult] = useState<{ winner: number; win_reason?: string; log: any; reward?: RewardInfo; stake?: StakeInfo } | null>(null);
  const [floats, setFloats] = useState<FloatingNum[]>([]);
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState<0 | 1 | null>(null);
  const [botPersonality, setBotPersonality] = useState(1);
  const [difficulty, setDifficulty] = useState(55);
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [stake, setStake] = useState('');           // BOT; '' = free play
  const [showKeypad, setShowKeypad] = useState(false);
  const [escrowBotId, setEscrowBotId] = useState<number>(0);
  const [staking, setStaking] = useState(false);
  const [stuckGames, setStuckGames] = useState<{ game_id: number; stake_wei: string }[]>([]);
  const [payout, setPayout] = useState<{ ok: boolean; problems: string[]; max_stake_wei: string } | null>(null);
  const [settleState, setSettleState] = useState<'idle' | 'retrying' | 'paid'>('idle');
  const { rotated, containerStyle, activate } = useLandscapeGameMode();
  const wsRef = useRef<WebSocket | null>(null);
  const holdStart = useRef<number>(0);
  const floatId = useRef(0);
  const vol = settings.sfx ? settings.masterVolume : 0;

  // ---- pixelverse fx plumbing
  const stageRef = useRef<HTMLDivElement>(null);
  const spriteRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const fxRef = useRef<PixelFxHandle>(null);

  /** Spray particles at fighter `slot`'s sprite. */
  const burstAt = useCallback(
    (slot: 0 | 1, kind: Parameters<PixelFxHandle['burst']>[0], power = 1) => {
      const p = localCentre(spriteRefs.current[slot], stageRef.current);
      if (p) fxRef.current?.burst(kind, p.x, p.y, power);
    },
    [],
  );

  /**
   * Knockback + hit-stop via the Web Animations API rather than a CSS
   * class: hits can land faster than an animation completes, and
   * re-adding a class that is already present does NOT restart it. .animate()
   * always plays from frame 0, so every single hit reads on screen.
   */
  const punchImpact = useCallback((slot: 0 | 1, heavy: boolean) => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = spriteRefs.current[slot];
    const dir = slot === 0 ? -1 : 1; // pushed away from the centre line
    const d = heavy ? 16 : 9;
    el?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: `translateX(${dir * d}px)` },
        { transform: `translateX(${-dir * d * 0.35}px)` },
        { transform: 'translateX(0)' },
      ],
      { duration: heavy ? 260 : 190, easing: 'steps(3, end)' },
    );
    // brightness-only flash on the stage — never transform, that would
    // fight the 90deg rotation the arena sits under on iOS
    stageRef.current?.animate(
      [
        { filter: 'brightness(1)' },
        { filter: `brightness(${heavy ? 2.6 : 1.9}) saturate(0.25)` },
        { filter: 'brightness(1)' },
      ],
      { duration: heavy ? 130 : 90, easing: 'steps(2, end)' },
    );
  }, []);

  // fight as one of your minted agents => wins/XP/points are recorded
  useEffect(() => {
    if (!connected || !address) { setMyAgents([]); setAgentId(null); return; }
    let live = true;
    api.agents(address)
      .then((a) => { if (!live) return; setMyAgents(a); if (a.length && agentId === null) setAgentId(a[0].token_id); })
      .catch(() => {});
    api.bots().then((b) => { if (live && b.length) setEscrowBotId(b[0].token_id); }).catch(() => {});
    api.reclaimableSolo(address).then((rows) => { if (live) setStuckGames(rows); }).catch(() => {});
    // can the arena actually pay a winner right now? checked before the
    // player is allowed to risk anything, not after they've won
    api.payoutHealth().then((h) => { if (live) setPayout(h); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address]);

  // A stake that didn't settle live is retried by the backend. Poll until
  // it lands so the player sees the payout arrive instead of being left
  // staring at "settling on-chain…" forever.
  useEffect(() => {
    const s = result?.stake;
    if (phase !== 'result' || !s || s.settled || !s.won) { setSettleState('idle'); return; }
    setSettleState('retrying');
    let live = true;
    const id = setInterval(async () => {
      try {
        const rows = await api.awaitingPayout(address ?? '');
        if (!live) return;
        if (rows.length === 0) {   // no longer awaiting => it went through
          setSettleState('paid');
          toast.success('Payout confirmed on-chain — BOT is in your wallet');
          clearInterval(id);
        }
      } catch { /* keep trying */ }
    }, 5000);
    return () => { live = false; clearInterval(id); };
  }, [phase, result?.stake, address]);

  const chosen = myAgents.find((a) => a.token_id === agentId);
  const mySkin = chosen?.skin ? AVATARS[chosen.skin]?.src : undefined;

  const update = (patch: Partial<CombatSettings>) =>
    setSettings((s) => { const next = { ...s, ...patch }; saveSettings(next); return next; });

  const addFloat = useCallback((slot: 0 | 1, text: string, cls: string) => {
    const id = ++floatId.current;
    setFloats((f) => [...f, { id, slot, text, cls }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 900);
  }, []);

  const handleEvents = useCallback((events: any[]) => {
    for (const e of events) {
      // `who` is the attacker; the sprite that REACTS is the other one
      const victim = (e.who === 0 ? 1 : 0) as 0 | 1;
      switch (e.kind) {
        case 'hit': {
          const heavy = e.attack === 'heavy';
          (heavy ? sfx.heavy : e.crit ? sfx.crit : sfx.hit)(vol);
          if (settings.damageNumbers)
            addFloat(victim, `-${e.dmg}${e.crit ? '!' : ''}`, e.crit ? 'text-warning text-xl' : 'text-destructive text-base');
          burstAt(victim, e.crit ? 'crit' : 'hit', heavy ? 1.6 : 1);
          punchImpact(victim, heavy || !!e.crit);
          if (settings.screenShake) { setShake(true); setTimeout(() => setShake(false), 180); }
          setFlash(victim); setTimeout(() => setFlash(null), 140);
          if (e.who === 1 && settings.haptics) haptic(heavy ? 60 : 30);
          break;
        }
        case 'blocked':
          sfx.block(vol);
          if (settings.damageNumbers) addFloat(victim, `BLOCK -${e.dmg}`, 'text-primary text-[10px]');
          burstAt(victim, 'block', 1);
          break;
        case 'parry':
          sfx.parry(vol);
          // `who` on a parry is the defender who pulled it off
          addFloat(e.who as 0 | 1, 'PARRY!', 'text-success text-xl');
          burstAt(e.who as 0 | 1, 'parry', 1.2);
          if (e.who === 0 && settings.haptics) haptic([20, 40, 20]);
          break;
        case 'windup':
          if (e.who === 1) sfx.windup(vol);
          break;
        case 'exhausted':
          sfx.exhausted(vol);
          addFloat(e.who as 0 | 1, 'EXHAUSTED', 'text-accent text-[10px]');
          break;

        // ---- special / super ----
        case 'super_start':
          sfx.windup(vol);
          addFloat(e.who as 0 | 1, 'SUPER!', 'text-warning text-xl');
          burstAt(e.who as 0 | 1, 'spawn', 1.4);
          if (settings.haptics) haptic([30, 30, 30]);
          break;
        case 'super_hit':
          sfx.ko(vol);
          if (settings.damageNumbers) addFloat(victim, `-${e.dmg}!!`, 'text-warning text-2xl');
          burstAt(victim, 'ko', 1);
          punchImpact(victim, true);
          if (settings.screenShake) { setShake(true); setTimeout(() => setShake(false), 320); }
          setFlash(victim); setTimeout(() => setFlash(null), 240);
          if (settings.haptics) haptic([70, 40, 90]);
          break;
        case 'super_blocked':
          sfx.block(vol);
          if (settings.damageNumbers) addFloat(victim, `GUARD -${e.dmg}`, 'text-primary text-base');
          burstAt(victim, 'block', 2);
          punchImpact(victim, true);
          if (settings.screenShake) { setShake(true); setTimeout(() => setShake(false), 200); }
          break;
        case 'super_parried':
          sfx.parry(vol);
          addFloat(e.who as 0 | 1, 'PERFECT!', 'text-success text-2xl');
          burstAt(e.who as 0 | 1, 'parry', 2);
          if (settings.haptics) haptic([20, 30, 20, 30, 60]);
          break;
        case 'ko':
          sfx.ko(vol);
          // the KO'd fighter is the one who did NOT land it
          burstAt(victim, 'ko', 1);
          punchImpact(victim, true);
          if (settings.haptics) haptic([80, 60, 120]);
          break;
      }
    }
  }, [vol, settings, addFloat, burstAt, punchImpact]);

  const connect = useCallback((gameId?: number) => {
    activate();
    setPhase('connecting');
    setResult(null);
    setState(null);
    fxRef.current?.clear();
    const params: Record<string, string | number> = {
      personality: 0, power: 72, bot_personality: botPersonality, difficulty,
    };
    if (address) params.wallet = address;         // earn points every fight
    if (agentId !== null) params.agent_id = agentId; // wins/XP hit this agent
    if (gameId !== undefined) params.game_id = gameId; // staked: this fight settles it
    const ws = new WebSocket(combatWsUrl(params));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg: ServerMsg = JSON.parse(ev.data);
      if (msg.kind === 'countdown') { setPhase('countdown'); setCountdown(msg.n); sfx.count(vol); }
      else if (msg.kind === 'fight') {
        setPhase('fight');
        sfx.fight(vol);
        // sprites materialise into the arena on the bell
        requestAnimationFrame(() => { burstAt(0, 'spawn'); burstAt(1, 'spawn'); });
      }
      else if (msg.kind === 'state') { setState(msg); if (msg.events.length) handleEvents(msg.events); }
      else if (msg.kind === 'error') { toast.error(msg.message); setPhase('setup'); }
      else if (msg.kind === 'result') { setResult(msg); setPhase('result'); }
    };
    ws.onerror = () => setPhase('setup');
    ws.onclose = () => { setPhase((p) => (p === 'result' ? p : p === 'fight' || p === 'countdown' || p === 'connecting' ? 'setup' : p)); };
  }, [botPersonality, difficulty, vol, handleEvents, activate, address, agentId, burstAt]);

  useEffect(() => () => wsRef.current?.close(), []);

  // Confetti-equivalent for a win: a fountain of pixels from the bottom
  // corners of the stage as the result card slams in.
  useEffect(() => {
    if (phase !== 'result' || result?.winner !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const { clientWidth: w, clientHeight: h } = stage;
    let n = 0;
    const id = setInterval(() => {
      fxRef.current?.burst('crit', w * (n % 2 === 0 ? 0.18 : 0.82), h * 0.95, 1.2);
      if (++n >= 6) clearInterval(id);
    }, 130);
    return () => clearInterval(id);
  }, [phase, result?.winner]);

  /** Stake BOT on this fight via SoloArena, then fight for it live. */
  const fightStaked = useCallback(async () => {
    if (!address || agentId === null) return;
    let value: bigint;
    try { value = parseEther(stake); } catch { return toast.error('Invalid stake amount'); }
    if (value <= BigInt(0)) return toast.error('Stake must be above 0');
    setStaking(true);
    try {
      const receipt = await writeContract({
        address: ADDRESSES.soloArena,
        abi: SOLO_ARENA_ABI as any,
        functionName: 'play',
        args: [BigInt(agentId), BigInt(escrowBotId)],
        value,
        account: address as `0x${string}`,
      });
      const played = eventArgs<{ gameId: bigint }>(receipt, SOLO_ARENA_ABI as any, 'SoloPlayed');
      if (!played) throw new Error('Stake confirmed but game id not found in receipt');
      const gameId = Number(played.gameId);
      // wait for the backend to index the game before entering the arena
      for (let i = 0; i < 12; i++) {
        try { await api.soloGame(gameId); break; }
        catch { await new Promise((r) => setTimeout(r, 1000)); }
      }
      toast.success(`${stake} BOT staked — win this fight to take 1.8×`);
      connect(gameId);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? 'Staking failed');
    } finally { setStaking(false); }
  }, [address, agentId, stake, escrowBotId, connect]);

  const startFight = () => {
    const wantsStake = stake.trim() !== '' && Number(stake) > 0;
    if (wantsStake && payout && !payout.ok) {
      return toast.error(
        payout.problems[0] ?? 'Staking is offline right now — you can still play for free',
      );
    }
    if (wantsStake) {
      // reject a stake the house provably can't cover, rather than
      // letting play() revert StakeTooLarge after a wallet prompt
      const max = payout ? Number(formatEther(BigInt(payout.max_stake_wei))) : Infinity;
      if (Number(stake) > max) {
        return toast.error(`Max stake right now is ${max.toFixed(2)} BOT (prize pool limit)`);
      }
      return fightStaked();
    }
    connect();
  };

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
  const unleashSuper = () => {
    // server re-checks the meter; this is just the request
    wsRef.current?.send(JSON.stringify({ type: 'super' }));
    if (settings.haptics) haptic([15, 25, 40]);
  };

  const me = state?.fighters[0];
  const bot = state?.fighters[1];
  const now = state?.t ?? 0;
  const reason = result?.win_reason ? WIN_REASON_TEXT[result.win_reason] : undefined;
  const iWon = result?.winner === 0;

  // ------------------------------------------------------------- render
  return (
    // Outer shell owns ONLY position + the iOS 90deg rotation. Nothing
    // here may animate `transform`, or it would cancel that rotation.
    <div className="z-50 select-none overflow-hidden"
      style={{ ...containerStyle, touchAction: 'none' }}>
      {/* Inner stage owns the look and every screen-level effect. */}
      <div
        ref={stageRef}
        className={cn(
          'crt relative h-full w-full overflow-hidden bg-stage',
          shake && 'animate-[pxshake_0.18s_steps(3,end)]',
        )}
      >
        <style>{`@keyframes pxshake{25%{transform:translate(-6px,2px)}50%{transform:translate(5px,-3px)}75%{transform:translate(-3px,1px)}}`}</style>

      {/* ---------------- pixel arena backdrop, back to front ---------- */}
      {/* deep parallax starfield */}
      <div className="px-stars pointer-events-none absolute inset-0 opacity-50" />
      {/* scrolling perspective floor */}
      <div className="px-floor pointer-events-none absolute inset-x-0 bottom-0 h-[38%] opacity-45" />
      {/* horizon glow + the old hex texture, dimmed to sit under the pixels */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-hexes opacity-20" />
      <div className="pointer-events-none absolute inset-x-[8%] bottom-[26%] split-line opacity-60" />
      {/* limited-palette dither veil over the whole scene */}
      <div className="px-dither pointer-events-none absolute inset-0 opacity-60" />
      {/* rolling CRT band */}
      <div className="crt-roll" />

      {/* particle layer — above the stage, below the HUD and controls */}
      <div className="pointer-events-none absolute inset-0 z-[15]">
        <PixelFx ref={fxRef} />
      </div>

      {/* HUD: life + stamina, blue vs orange */}
      {state && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3">
          {[{ f: me!, right: false }, { f: bot!, right: true }].map(({ f, right }, i) => {
            const pct = (f.hp / f.max_hp) * 100;
            const critical = pct <= 25;
            return (
              <div key={i} className={cn('flex-1 space-y-1.5', right && 'text-right')}>
                <div className={cn('flex items-baseline gap-2 font-pixel pixel-text text-[8px] sm:text-[10px]', right && 'flex-row-reverse')}>
                  <span className={i === 0 ? 'text-primary' : 'text-accent'}>
                    {(i === 0 ? (chosen?.name ?? 'YOU') : 'BOT').toUpperCase().slice(0, 10)}
                  </span>
                  <span className={cn('tabular-nums', critical ? 'animate-px-blink text-destructive' : 'text-muted-foreground')}>
                    {f.hp}/{f.max_hp}
                  </span>
                </div>
                {/* health: hard-edged, segmented, steps between values */}
                <div
                  className={cn('pixel-bar h-3 overflow-hidden bg-black/70', right && 'scale-x-[-1]')}
                  style={{ ['--px-edge' as any]: 'hsl(var(--border))', boxShadow: 'inset 0 0 0 2px hsl(var(--border))' }}
                >
                  <div
                    className={cn(
                      'pixel-bar-fill h-full',
                      critical ? 'bg-destructive' : i === 0 ? 'bg-primary' : 'bg-accent',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {/* stamina: thinner, same treatment */}
                <div className={cn('pixel-bar h-1.5 overflow-hidden bg-black/60', right && 'scale-x-[-1]')}>
                  <div
                    className={cn('pixel-bar-fill h-full', now < f.exhausted_until ? 'bg-destructive' : 'bg-warning/90')}
                    style={{ width: `${f.stamina}%` }}
                  />
                </div>
                {/* SUPER meter — flashes when the special is available */}
                <div className={cn('pixel-bar h-2 overflow-hidden bg-black/70', right && 'scale-x-[-1]')}
                  style={f.super_ready ? { boxShadow: 'inset 0 0 0 2px hsl(var(--warning))' } : undefined}>
                  <div
                    className={cn(
                      'pixel-bar-fill h-full',
                      f.super_ready
                        ? 'animate-px-blink bg-warning'
                        : 'bg-gradient-to-r from-primary/70 to-warning/80',
                    )}
                    style={{ width: `${f.super_meter}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {phase === 'fight' && state && (() => {
        const secs = Math.max(0, Math.ceil((90000 - now) / 1000));
        return (
          <div className={cn(
            'absolute left-1/2 top-2 z-20 -translate-x-1/2 font-pixel pixel-text text-sm tabular-nums',
            secs <= 10 ? 'animate-px-blink text-destructive' : 'text-foreground',
          )}>
            {String(secs).padStart(2, '0')}
          </div>
        );
      })()}

      {/* fighters */}
      {state && (
        <div className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 items-center justify-around px-[12%]">
          {[
            { f: me!, slot: 0 as const, glyph: '⚔', src: mySkin,
              color: 'from-primary/35 to-primary/5 ring-primary/60' },
            { f: bot!, slot: 1 as const, glyph: ['⚔', '🛡', '◈'][botPersonality], src: undefined,
              color: 'from-accent/35 to-accent/5 ring-accent/60' },
          ].map(({ f, slot, glyph, src, color }) => {
            const winding = f.phase === 'windup';
            // Must match the real wind-up length per attack kind, or the
            // telegraph lies: a super winds up for 900ms, so measuring it
            // against 500 leaves the bar empty for the first 400ms —
            // exactly the window the defender needs to see it coming.
            const windMs = f.attack_kind === 'super' ? SUPER_WINDUP_MS : 500;
            const windPct = winding ? Math.min(1, 1 - (f.phase_ends_at - now) / windMs) : 0;
            const lunge = winding ? (slot === 0 ? windPct * 26 : -windPct * 26) : 0;
            return (
              <div key={slot} className="relative flex flex-col items-center">
                {floats.filter((x) => x.slot === slot).map((x) => (
                  <span key={x.id}
                    className={cn('pointer-events-none absolute -top-12 whitespace-nowrap animate-px-float-up font-pixel pixel-text', x.cls)}>
                    {x.text}
                  </span>
                ))}

                {/* shockwave ring — fires whenever this sprite is flashing */}
                {flash === slot && (
                  <span className={cn(
                    'pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2',
                    'animate-px-shock border-solid',
                    slot === 0 ? 'border-primary' : 'border-accent',
                  )} />
                )}

                {/* the sprite box. `lunge` lives on this WRAPPER so the
                    knockback animation on the inner node never overwrites
                    it — two transforms, two elements. */}
                <div style={{ transform: `translateX(${lunge}px)` }}>
                  <div
                    ref={(el) => { spriteRefs.current[slot] = el; }}
                    className={cn(
                      'pixel-frame flex h-24 w-24 items-center justify-center overflow-hidden bg-gradient-to-br p-1.5 text-5xl sm:h-28 sm:w-28 sm:text-6xl',
                      color,
                      !winding && f.phase === 'idle' && 'animate-px-idle',
                      flash === slot && 'brightness-[3] contrast-200',
                      f.blocking && 'shadow-[0_0_0_4px_hsl(204_95%_53%),0_0_28px_hsl(204_95%_53%/0.6)]',
                      slot === 1 && f.blocking && 'shadow-[0_0_0_4px_hsl(30_100%_52%),0_0_28px_hsl(30_100%_52%/0.6)]',
                      now < f.staggered_until && 'rotate-12 opacity-70',
                      now < f.exhausted_until && 'saturate-0',
                    )}
                    style={{
                      ['--px-edge' as any]: winding && f.attack_kind === 'super'
                        ? 'hsl(var(--warning))'
                        : winding && f.attack_kind === 'heavy'
                          ? 'hsl(var(--warning))'
                          : slot === 0 ? 'hsl(var(--primary))' : 'hsl(var(--accent))',
                      // a super charging up is unmistakable — it's the
                      // one telegraph the opponent MUST react to
                      ...(winding && f.attack_kind === 'super'
                        ? { filter: 'brightness(1.6) saturate(1.6)' }
                        : {}),
                    }}
                  >
                    {f.blocking ? '🛡' : <FighterSprite src={src} glyph={glyph} flip={slot === 1} />}
                  </div>
                </div>

                {winding && (
                  <>
                    <div className={cn('pixel-bar mt-2 h-1.5 overflow-hidden bg-black/70',
                      f.attack_kind === 'super' ? 'w-24' : 'w-20')}>
                      <div
                        className={cn('pixel-bar-fill h-full',
                          f.attack_kind === 'super' ? 'animate-px-blink bg-warning'
                            : f.attack_kind === 'heavy' ? 'bg-warning' : 'bg-foreground/80')}
                        style={{ width: `${windPct * 100}%` }}
                      />
                    </div>
                    {f.attack_kind === 'super' && (
                      <span className="mt-1 animate-px-blink font-pixel pixel-text text-[8px] text-warning">
                        SUPER
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* countdown: split VS screen */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 z-30 bg-vs-split">
          <div className="px-dither pointer-events-none absolute inset-0 opacity-70" />
          <div className="absolute inset-0 flex items-center justify-around px-[10%]">
            <div className="pixel-frame animate-slide-in-l flex h-28 w-28 items-center justify-center overflow-hidden bg-primary/15 p-2 text-6xl sm:h-32 sm:w-32 sm:text-7xl"
              style={{ ['--px-edge' as any]: 'hsl(var(--primary))' }}>
              <FighterSprite src={mySkin} glyph="⚔" />
            </div>
            <div className="pixel-frame animate-slide-in-r flex h-28 w-28 items-center justify-center bg-accent/15 text-6xl sm:h-32 sm:w-32 sm:text-7xl"
              style={{ ['--px-edge' as any]: 'hsl(var(--accent))' }}>
              <FighterSprite glyph={['⚔', '🛡', '◈'][botPersonality]} flip />
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span key={countdown} className="animate-px-slam font-pixel pixel-text text-6xl text-foreground sm:text-7xl">
              {countdown}
            </span>
            <span className="mt-4 font-pixel pixel-text animate-px-blink text-[10px] tracking-widest text-warning">
              GET READY
            </span>
          </div>
        </div>
      )}

      {/* setup: pick your fighter, then FIGHT */}
      {phase === 'setup' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-background/92 p-6 text-center backdrop-blur-sm">
          <h1 className="font-pixel pixel-text text-xl leading-relaxed sm:text-3xl">
            <span className="text-primary text-glow">äGENT</span>{' '}
            <span className="text-accent text-glow-accent">çOMBAT</span>
          </h1>
          <div className="split-line w-56" />
          <p className="max-w-md text-sm text-muted-foreground">
            Tap to strike, hold for a heavy. Defend right before impact for a{' '}
            <span className="text-success">PARRY</span>. Mashing drains stamina.
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            Landing hits charges your <span className="text-warning">SUPER</span> meter —
            when it&apos;s full, a third button appears. The special hits far harder than a
            heavy, but it winds up slowly: your opponent can block it, and a perfectly
            timed parry cancels it outright. Your equipped avatar changes hit power,
            defence, attack speed and how fast the meter charges.
          </p>

          {connected && myAgents.length > 0 && (
            <div className="flex max-w-full flex-wrap items-center justify-center gap-2 text-sm">
              <span className="text-muted-foreground">Fight as</span>
              {myAgents.map((a) => (
                <button key={a.token_id} onClick={() => setAgentId(a.token_id)}
                  className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-1.5',
                    agentId === a.token_id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                  {a.skin && AVATARS[a.skin] && (
                    <img src={AVATARS[a.skin].src} alt="" className="h-5 w-5 rounded" draggable={false} />
                  )}
                  {a.name}
                </button>
              ))}
            </div>
          )}
          {connected && myAgents.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No minted agent yet — you can still fight and earn points. Mint one to level it up through combat.
            </p>
          )}
          {!connected && (
            <p className="text-xs text-warning">
              Wallet not connected — this fight won't earn points or count as a win.
            </p>
          )}

          {/* Money management lives on /rewards — the arena stays a
              fight screen. Just a one-line pointer when something is
              actually waiting for them. */}
          {stuckGames.length > 0 && (
            <Link href="/rewards"
              className="flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-2.5 text-left">
              <span className="text-xs font-semibold text-warning">
                {stuckGames.length} stake{stuckGames.length > 1 ? 's' : ''} waiting to be recovered
              </span>
              <span className="flex items-center gap-1 font-display text-xs text-warning">
                REWARDS <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          )}

          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Opponent</span>
            {[0, 1, 2].map((p) => (
              <button key={p} onClick={() => setBotPersonality(p)}
                className={cn('rounded-lg border px-3 py-1.5', botPersonality === p ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground')}>
                {PERSONALITY_NAMES[p as 0 | 1 | 2]}
              </button>
            ))}
          </div>
          <div className="flex w-64 items-center gap-3 text-sm">
            <span className="text-muted-foreground">Difficulty</span>
            <Slider value={[difficulty]} min={40} max={90} step={5} onValueChange={([v]) => setDifficulty(v)} />
            <span className="w-8 tabular-nums">{difficulty}</span>
          </div>
          {/* Never let someone stake into an arena that can't pay them. */}
          {connected && payout && !payout.ok && (
            <div className="w-full max-w-md rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-left">
              <p className="font-display text-xs font-bold text-destructive">
                STAKING IS OFFLINE — free play only
              </p>
              <ul className="mt-1.5 list-inside list-disc text-xs text-muted-foreground">
                {payout.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          {connected && agentId !== null && (
            <div className="flex items-center gap-2 text-sm">
              <Coins className="h-4 w-4 text-warning" />
              <span className="text-muted-foreground">Stake</span>
              <input
                value={stake}
                readOnly={rotated}
                onFocus={(e) => { if (rotated) { e.target.blur(); setShowKeypad(true); } }}
                onClick={() => { if (rotated) setShowKeypad(true); }}
                onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0 = free"
                inputMode="decimal"
                className="w-24 rounded-lg border border-border bg-input px-2.5 py-1.5 text-right tabular-nums outline-none focus:border-warning"
              />
              <span className="text-muted-foreground">BOT · win pays <span className="text-warning">1.8×</span></span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button size="lg" onClick={startFight} disabled={staking}
              className="animate-pulse-glow font-display text-lg tracking-widest">
              {staking
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> STAKING…</>
                : <><Swords className="mr-2 h-5 w-5" /> {stake.trim() !== '' && Number(stake) > 0 ? `FIGHT · ${stake} BOT` : 'FIGHT'}</>}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setShowSettings(true)} className="font-display">
              <Settings className="mr-2 h-4 w-4" /> SETTINGS
            </Button>
          </div>
        </div>
      )}

      {phase === 'connecting' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center text-muted-foreground">Entering the arena…</div>
      )}

      {/* result: outcome + WHY + what you earned */}
      {phase === 'result' && result && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/95 p-6 text-center">
          <div className="px-dither pointer-events-none absolute inset-0 opacity-50" />
          <h2 className={cn('animate-px-slam font-pixel pixel-text text-2xl leading-relaxed sm:text-4xl',
            iWon ? 'text-primary text-glow' : 'text-accent text-glow-accent')}>
            {iWon ? 'VICTORY' : 'DEFEATED'}
          </h2>
          {reason && (
            <div className="max-w-sm">
              <div className="font-pixel pixel-text text-[10px] text-warning">{reason[0]}</div>
              <p className="mt-2 text-xs text-muted-foreground">{reason[1]}</p>
            </div>
          )}
          {result.log?.fighters && (
            <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm">
              {result.log.fighters.map((f: any, i: number) => (
                <div key={i} className="space-y-0.5">
                  <div className={cn('font-display font-bold', i === 0 ? 'text-primary' : 'text-accent')}>
                    {i === 0 ? 'YOU' : 'BOT'} · {f.score} pts
                  </div>
                  <div className="text-muted-foreground">
                    {f.hits} hits · {f.defends} defends · {f.parries} parries
                    {f.supers > 0 && <> · <span className="text-warning">{f.supers} super</span></>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.reward && (
            <div className="split-ring flex items-center gap-4 rounded-xl px-5 py-2.5 text-sm">
              <span className="flex items-center gap-1.5 font-display font-bold text-warning">
                <Star className="h-4 w-4" /> +{result.reward.points} pts
              </span>
              <span className="text-muted-foreground">balance {result.reward.total_points}</span>
              {result.reward.leveled_up && (
                <span className="flex items-center gap-1 font-display font-bold text-success">
                  <ChevronUp className="h-4 w-4" /> LEVEL UP
                </span>
              )}
            </div>
          )}
          {result.stake && (() => {
            const st = result.stake;
            const amount = Number(formatEther(BigInt(st.payout_wei))).toFixed(2);
            const staked = Number(formatEther(BigInt(st.stake_wei))).toFixed(2);
            // A win is only "paid" once the chain says so. Claiming
            // otherwise is what made this feel broken: VICTORY on screen,
            // nothing in the wallet, and no hint anything went wrong.
            const paid = st.won && (st.settled || settleState === 'paid');
            const stuck = st.won && !st.settled && settleState !== 'paid';
            return (
              <div className={cn('max-w-md rounded-xl border px-5 py-3 text-sm',
                paid ? 'border-success/50 bg-success/10 text-success'
                  : stuck ? 'border-warning/50 bg-warning/10 text-warning'
                    : 'border-destructive/50 bg-destructive/10 text-destructive')}>
                <div className="font-display font-bold">
                  {paid && `+${amount} BOT paid out (1.8× stake)`}
                  {stuck && (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Payout of {amount} BOT is still confirming
                    </span>
                  )}
                  {!st.won && `Stake lost (${staked} BOT)`}
                </div>
                {stuck && (
                  <p className="mt-1.5 font-body text-xs font-normal text-muted-foreground">
                    You won — the payout transaction hasn&apos;t landed yet and is being
                    retried automatically. Your {staked} BOT stake is still safely in
                    escrow; if this never completes you can reclaim it from the setup
                    screen after 1 hour.
                  </p>
                )}
              </div>
            );
          })()}
          {!result.reward && (
            <p className="text-xs text-muted-foreground">Connect your wallet before fighting to earn points and record wins.</p>
          )}
          <Button size="lg" onClick={() => connect()} className="font-display tracking-widest">
            REMATCH{result.stake ? ' · FREE' : ''}
          </Button>
          <Button variant="ghost" onClick={() => setPhase('setup')}>Change opponent</Button>
        </div>
      )}

      {/* the two buttons */}
      {phase === 'fight' && (
        <>
          {[{ label: 'DEF', icon: Shield, side: settings.swapButtons ? 'right' : 'left', onDown: defend, onUp: undefined, edge: 'hsl(var(--primary))', cls: 'text-primary active:bg-primary/25' },
            { label: 'ATK', icon: Swords, side: settings.swapButtons ? 'left' : 'right', onDown: attackDown, onUp: attackUp, edge: 'hsl(var(--accent))', cls: 'text-accent active:bg-accent/25' }].map((b) => (
            <button
              key={b.label}
              onPointerDown={(e) => { e.preventDefault(); b.onDown(); }}
              onPointerUp={(e) => { e.preventDefault(); b.onUp?.(); }}
              className={cn(
                'pixel-frame absolute z-20 flex flex-col items-center justify-center gap-1 bg-card/40 backdrop-blur-sm active:translate-y-[3px]',
                b.cls,
              )}
              style={{
                [b.side]: 28,
                bottom: `calc(${settings.buttonRaise}px + env(safe-area-inset-bottom))`,
                width: settings.buttonSize, height: settings.buttonSize,
                opacity: settings.buttonOpacity,
                ['--px-edge' as any]: b.edge,
              } as any}
            >
              <b.icon className="h-7 w-7" />
              <span className="font-pixel pixel-text text-[8px]">{b.label}</span>
            </button>
          ))}

          {/* SUPER — only exists once you've earned it, centred so it
              can't be fat-fingered instead of ATK/DEF */}
          {me?.super_ready && (
            <button
              onPointerDown={(e) => { e.preventDefault(); unleashSuper(); }}
              className="pixel-frame absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center justify-center gap-0.5 bg-warning/25 px-5 py-2 text-warning active:translate-y-[3px] active:bg-warning/40"
              style={{
                bottom: `calc(${settings.buttonRaise}px + env(safe-area-inset-bottom))`,
                opacity: settings.buttonOpacity,
                ['--px-edge' as any]: 'hsl(var(--warning))',
              } as any}
            >
              <Flame className="h-6 w-6 animate-px-blink" />
              <span className="font-pixel pixel-text text-[8px]">SUPER</span>
            </button>
          )}
        </>
      )}

      {showKeypad && (
        <StakeKeypad value={stake} onChange={setStake} onClose={() => setShowKeypad(false)} />
      )}

      {/* settings gear: above every overlay so it always opens */}
      <button onClick={() => setShowSettings(true)}
        className="absolute right-3 top-16 z-40 rounded-full border border-border bg-card/70 p-2 text-muted-foreground hover:text-foreground">
        <Settings className="h-4 w-4" />
      </button>
      {showSettings && (
        <div className="absolute inset-y-0 right-0 z-50 w-80 space-y-5 overflow-y-auto border-l border-border bg-card/95 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold text-steel">SETTINGS</h3>
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
    </div>
  );
}