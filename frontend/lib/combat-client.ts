'use client';

// ---------------------------------------------------------------- types

export interface FighterSnap {
  hp: number;
  max_hp: number;
  stamina: number;
  phase: 'idle' | 'windup' | 'cooldown';
  phase_ends_at: number;
  attack_kind: 'light' | 'heavy';
  blocking: boolean;
  exhausted_until: number;
  staggered_until: number;
  score: { damage: number; hits: number; attacks: number; defends: number; parries: number };
}

export interface StateMsg {
  kind: 'state';
  t: number;
  over: boolean;
  winner: number | null;
  fighters: [FighterSnap, FighterSnap];
  events: any[];
}

export interface RewardInfo {
  points: number;
  total_points: number;
  won: boolean;
  leveled_up: boolean;
}

export type ServerMsg =
  | { kind: 'countdown'; n: number }
  | { kind: 'fight' }
  | StateMsg
  | {
      kind: 'result';
      winner: number;
      win_reason?: 'ko' | 'score' | 'hp' | 'tiebreak';
      log: any;
      reward?: RewardInfo;
    };

export function combatWsUrl(params: Record<string, string | number>): string {
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const ws = api.replace(/^http/, 'ws');
  const q = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${ws}/ws/combat/practice?${q}`;
}

// ------------------------------------------------------------- settings

export interface CombatSettings {
  swapButtons: boolean; // attack on left instead
  buttonSize: number; // px
  buttonOpacity: number; // 0..1
  buttonRaise: number; // px from bottom
  masterVolume: number; // 0..1
  sfx: boolean;
  haptics: boolean;
  screenShake: boolean;
  damageNumbers: boolean;
}

export const DEFAULT_SETTINGS: CombatSettings = {
  swapButtons: false,
  buttonSize: 96,
  buttonOpacity: 0.85,
  buttonRaise: 24,
  masterVolume: 0.7,
  sfx: true,
  haptics: true,
  screenShake: true,
  damageNumbers: true,
};

const KEY = 'agent-combat-settings';

export function loadSettings(): CombatSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: CombatSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

// ----------------------------------------------------------------- sfx

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  durMs: number,
  type: OscillatorType,
  vol: number,
  slideTo?: number,
) {
  const a = ac();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + durMs / 1000);
  gain.gain.setValueAtTime(vol, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + durMs / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + durMs / 1000);
}

export const sfx = {
  hit: (v: number) => { tone(180, 90, 'square', 0.25 * v, 90); },
  heavy: (v: number) => { tone(110, 160, 'sawtooth', 0.3 * v, 55); },
  crit: (v: number) => { tone(320, 120, 'square', 0.3 * v, 150); tone(640, 80, 'square', 0.15 * v); },
  block: (v: number) => { tone(520, 60, 'triangle', 0.2 * v, 420); },
  parry: (v: number) => { tone(880, 130, 'sine', 0.3 * v, 1320); },
  windup: (v: number) => { tone(70, 120, 'sine', 0.12 * v, 140); },
  exhausted: (v: number) => { tone(200, 350, 'sawtooth', 0.18 * v, 60); },
  ko: (v: number) => { tone(400, 700, 'sawtooth', 0.35 * v, 40); },
  count: (v: number) => { tone(660, 110, 'sine', 0.22 * v); },
  fight: (v: number) => { tone(660, 90, 'square', 0.25 * v); tone(990, 220, 'square', 0.25 * v); },
};

export function haptic(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}
