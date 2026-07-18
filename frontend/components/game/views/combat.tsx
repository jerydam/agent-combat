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
import { Settings, X, Swords, Shield, Star, ChevronUp, Coins, Loader2 } from 'lucide-react';
import { useLandscapeGameMode } from '@/lib/game-mode';

interface FloatingNum { id: number; slot: 0 | 1; text: string; cls: string }

const WIN_REASON_TEXT: Record<string, [string, string]> = {
  ko:       ['KNOCKOUT', 'You dropped your opponent to 0 HP — a KO ends the fight instantly, whatever the score.'],
  score:    ['ON POINTS', 'Time ran out — higher score (damage + defends + parries) takes it.'],
  hp:       ['ON HEALTH', 'Scores were level at the bell — more HP remaining takes it.'],
  tiebreak: ['TIEBREAK', 'Dead even at the bell — decided on speed.'],
};

function FighterSprite({ src, glyph, flip }: { src?: string; glyph: string; flip?: boolean }) {
  if (src) {
    return (
      <img src={src} alt="" draggable={false}
        className={cn('h-full w-full object-contain drop-shadow-lg', flip && 'scale-x-[-1]')} />
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
  const [escrowBotId, setEscrowBotId] = useState<number>(0);
  const [staking, setStaking] = useState(false);
  const { containerStyle, activate } = useLandscapeGameMode();
  const wsRef = useRef<WebSocket | null>(null);
  const holdStart = useRef<number>(0);
  const floatId = useRef(0);
  const vol = settings.sfx ? settings.masterVolume : 0;

  // fight as one of your minted agents => wins/XP/points are recorded
  useEffect(() => {
    if (!connected || !address) { setMyAgents([]); setAgentId(null); return; }
    let live = true;
    api.agents(address)
      .then((a) => { if (!live) return; setMyAgents(a); if (a.length && agentId === null) setAgentId(a[0].token_id); })
      .catch(() => {});
    api.bots().then((b) => { if (live && b.length) setEscrowBotId(b[0].token_id); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address]);

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
      switch (e.kind) {
        case 'hit':
          (e.attack === 'heavy' ? sfx.heavy : e.crit ? sfx.crit : sfx.hit)(vol);
          if (settings.damageNumbers)
            addFloat(e.who === 0 ? 1 : 0, `-${e.dmg}${e.crit ? '!' : ''}`, e.crit ? 'text-warning text-2xl' : 'text-destructive');
          if (settings.screenShake) { setShake(true); setTimeout(() => setShake(false), 180); }
          setFlash(e.who === 0 ? 1 : 0); setTimeout(() => setFlash(null), 140);
          if (e.who === 1 && settings.haptics) haptic(e.attack === 'heavy' ? 60 : 30);
          break;
        case 'blocked':
          sfx.block(vol);
          if (settings.damageNumbers) addFloat(e.who as 0 | 1, `block -${e.dmg}`, 'text-primary text-sm');
          break;
        case 'parry':
          sfx.parry(vol);
          addFloat(e.who as 0 | 1, 'PARRY!', 'text-success text-2xl font-bold');
          if (e.who === 0 && settings.haptics) haptic([20, 40, 20]);
          break;
        case 'windup':
          if (e.who === 1) sfx.windup(vol);
          break;
        case 'exhausted':
          sfx.exhausted(vol);
          addFloat(e.who as 0 | 1, 'EXHAUSTED', 'text-accent text-sm');
          break;
        case 'ko':
          sfx.ko(vol);
          if (settings.haptics) haptic([80, 60, 120]);
          break;
      }
    }
  }, [vol, settings, addFloat]);

  const connect = useCallback((gameId?: number) => {
    activate();
    setPhase('connecting');
    setResult(null);
    setState(null);
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
      else if (msg.kind === 'fight') { setPhase('fight'); sfx.fight(vol); }
      else if (msg.kind === 'state') { setState(msg); if (msg.events.length) handleEvents(msg.events); }
      else if (msg.kind === 'error') { toast.error(msg.message); setPhase('setup'); }
      else if (msg.kind === 'result') { setResult(msg); setPhase('result'); }
    };
    ws.onerror = () => setPhase('setup');
    ws.onclose = () => { setPhase((p) => (p === 'result' ? p : p === 'fight' || p === 'countdown' || p === 'connecting' ? 'setup' : p)); };
  }, [botPersonality, difficulty, vol, handleEvents, activate, address, agentId]);

  useEffect(() => () => wsRef.current?.close(), []);

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
    if (stake.trim() !== '' && Number(stake) > 0) fightStaked();
    else connect();
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

  const me = state?.fighters[0];
  const bot = state?.fighters[1];
  const now = state?.t ?? 0;
  const reason = result?.win_reason ? WIN_REASON_TEXT[result.win_reason] : undefined;
  const iWon = result?.winner === 0;

  // ------------------------------------------------------------- render
  return (
    <div className={cn('z-50 select-none overflow-hidden bg-stage', shake && 'animate-[shake_0.18s]')}
      style={{ ...containerStyle, touchAction: 'none' }}>
      <style>{`@keyframes shake{25%{transform:translate(-6px,2px)}50%{transform:translate(5px,-3px)}75%{transform:translate(-3px,1px)}}
        @keyframes floatUp{to{transform:translateY(-48px);opacity:0}}`}</style>

      {/* stage floor */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-hexes opacity-40" />
      <div className="pointer-events-none absolute inset-x-[8%] bottom-[26%] split-line opacity-60" />

      {/* HUD: life + stamina, blue vs orange */}
      {state && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3">
          {[{ f: me!, right: false }, { f: bot!, right: true }].map(({ f, right }, i) => (
            <div key={i} className={cn('flex-1 space-y-1', right && 'text-right')}>
              <div className={cn('flex items-baseline gap-2 font-display text-xs font-bold', right && 'flex-row-reverse')}>
                <span className={i === 0 ? 'text-primary' : 'text-accent'}>
                  {i === 0 ? (chosen?.name?.toUpperCase() ?? 'YOU') : 'BOT'}
                </span>
                <span className="tabular-nums text-muted-foreground">{f.hp}/{f.max_hp}</span>
              </div>
              <div className={cn('h-3 overflow-hidden rounded border border-border/60 bg-secondary', right && 'scale-x-[-1]')}>
                <div className={cn('h-full transition-all duration-200', i === 0 ? 'bg-primary' : 'bg-accent')}
                  style={{ width: `${(f.hp / f.max_hp) * 100}%` }} />
              </div>
              <div className={cn('h-1.5 overflow-hidden rounded bg-secondary/70', right && 'scale-x-[-1]')}>
                <div className={cn('h-full', now < f.exhausted_until ? 'bg-destructive' : 'bg-warning/80')}
                  style={{ width: `${f.stamina}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {phase === 'fight' && state && (
        <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2 font-display text-lg font-bold tabular-nums text-steel">
          {Math.max(0, Math.ceil((90000 - now) / 1000))}
        </div>
      )}

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
            const windPct = winding ? Math.min(1, 1 - (f.phase_ends_at - now) / 500) : 0;
            const lunge = winding ? (slot === 0 ? windPct * 26 : -windPct * 26) : 0;
            return (
              <div key={slot} className="relative flex flex-col items-center">
                {floats.filter((x) => x.slot === slot).map((x) => (
                  <span key={x.id} className={cn('absolute -top-10 animate-[floatUp_0.9s_ease-out_forwards] font-display font-bold', x.cls)}>{x.text}</span>
                ))}
                <div
                  className={cn(
                    'flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br p-1.5 text-6xl ring-4 transition-transform duration-100',
                    color,
                    flash === slot && 'brightness-[2.5]',
                    f.blocking && 'ring-primary shadow-[0_0_30px_hsl(204_95%_53%/0.6)]',
                    slot === 1 && f.blocking && 'ring-accent shadow-[0_0_30px_hsl(30_100%_52%/0.6)]',
                    now < f.staggered_until && 'rotate-12 opacity-70',
                    now < f.exhausted_until && 'saturate-0',
                    winding && f.attack_kind === 'heavy' && 'ring-warning',
                  )}
                  style={{ transform: `translateX(${lunge}px)` }}
                >
                  {f.blocking ? '🛡' : <FighterSprite src={src} glyph={glyph} flip={slot === 1} />}
                </div>
                {winding && (
                  <div className="mt-2 h-1 w-20 overflow-hidden rounded bg-secondary">
                    <div className={cn('h-full', f.attack_kind === 'heavy' ? 'bg-warning' : 'bg-foreground/70')} style={{ width: `${windPct * 100}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* countdown: split VS screen */}
      {phase === 'countdown' && (
        <div className="absolute inset-0 z-30 bg-vs-split">
          <div className="absolute inset-0 flex items-center justify-around px-[10%]">
            <div className="animate-slide-in-l flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl bg-primary/15 p-2 text-7xl ring-4 ring-primary/60">
              <FighterSprite src={mySkin} glyph="⚔" />
            </div>
            <div className="animate-slide-in-r flex h-32 w-32 items-center justify-center rounded-2xl bg-accent/15 text-7xl ring-4 ring-accent/60">
              <FighterSprite glyph={['⚔', '🛡', '◈'][botPersonality]} flip />
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="animate-vs-slam font-display text-8xl font-black text-steel">{countdown}</span>
            <span className="mt-2 font-display text-sm tracking-[0.4em] text-muted-foreground">GET READY</span>
          </div>
        </div>
      )}

      {/* setup: pick your fighter, then FIGHT */}
      {phase === 'setup' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
          <h1 className="font-display text-4xl font-black tracking-widest">
            <span className="text-primary text-glow">äGENT</span>{' '}
            <span className="text-accent text-glow-accent">çOMBAT</span>
          </h1>
          <div className="split-line w-56" />
          <p className="max-w-md text-sm text-muted-foreground">
            Tap to strike, hold for a heavy. Defend right before impact for a{' '}
            <span className="text-success">PARRY</span>. Mashing drains stamina.
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
          {connected && agentId !== null && (
            <div className="flex items-center gap-2 text-sm">
              <Coins className="h-4 w-4 text-warning" />
              <span className="text-muted-foreground">Stake</span>
              <input
                value={stake}
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
          <h2 className={cn('animate-vs-slam font-display text-5xl font-black', iWon ? 'text-primary text-glow' : 'text-accent text-glow-accent')}>
            {iWon ? 'VICTORY' : 'DEFEATED'}
          </h2>
          {reason && (
            <div className="max-w-sm">
              <div className="font-display text-sm font-bold tracking-[0.3em] text-steel">{reason[0]}</div>
              <p className="mt-1 text-xs text-muted-foreground">{reason[1]}</p>
            </div>
          )}
          {result.log?.fighters && (
            <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm">
              {result.log.fighters.map((f: any, i: number) => (
                <div key={i} className="space-y-0.5">
                  <div className={cn('font-display font-bold', i === 0 ? 'text-primary' : 'text-accent')}>
                    {i === 0 ? 'YOU' : 'BOT'} · {f.score} pts
                  </div>
                  <div className="text-muted-foreground">{f.hits} hits · {f.defends} defends · {f.parries} parries</div>
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
          {result.stake && (
            <div className={cn('rounded-xl border px-5 py-2.5 text-sm font-display font-bold',
              result.stake.won ? 'border-success/50 bg-success/10 text-success' : 'border-destructive/50 bg-destructive/10 text-destructive')}>
              {result.stake.won
                ? `+${Number(formatEther(BigInt(result.stake.payout_wei))).toFixed(2)} BOT paid out (1.8× stake)`
                : `Stake lost (${Number(formatEther(BigInt(result.stake.stake_wei))).toFixed(2)} BOT)`}
              {!result.stake.settled && (
                <span className="ml-2 font-body text-xs font-normal text-muted-foreground">settling on-chain…</span>
              )}
            </div>
          )}
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
          {[{ label: 'DEF', icon: Shield, side: settings.swapButtons ? 'right' : 'left', onDown: defend, onUp: undefined, cls: 'border-primary/60 text-primary active:bg-primary/20' },
            { label: 'ATK', icon: Swords, side: settings.swapButtons ? 'left' : 'right', onDown: attackDown, onUp: attackUp, cls: 'border-accent/60 text-accent active:bg-accent/20' }].map((b) => (
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
  );
}
