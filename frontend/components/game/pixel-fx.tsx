'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * PixelVerse particle layer.
 *
 * The whole look rests on one trick: the canvas backing store is kept at
 * a FRACTION of its on-screen size (1 / PIXEL_SCALE) and then stretched
 * back up by the browser with `image-rendering: pixelated`. So a particle
 * drawn as a 1x1 canvas rect lands on screen as a hard, aliased 5x5
 * block. Nothing is ever antialiased, positions are floored to the
 * low-res grid, and colours come from a fixed palette — which is exactly
 * how a real sprite engine behaves and why this reads as pixel art
 * rather than as blurred HD circles.
 */

const PIXEL_SCALE = 5; // on-screen size of one "pixel"
const GRAVITY = 0.06; // low-res px per frame^2
const MAX_PARTICLES = 700;

export type BurstKind = 'hit' | 'crit' | 'block' | 'parry' | 'ko' | 'spawn';

/** Fixed palettes — limited colour counts keep the 8-bit feel. */
const PALETTES: Record<BurstKind, string[]> = {
  // impact sparks: hot white core -> orange -> deep red
  hit: ['#ffffff', '#ffe9a8', '#ff9d3d', '#ff4d2e', '#b81f1f'],
  // crits go gold and keep a white-hot core longer
  crit: ['#ffffff', '#fff6c2', '#ffd23d', '#ff9500', '#ff3d00'],
  // blocked: cold blue shield shards
  block: ['#ffffff', '#bfe6ff', '#38bdf8', '#1f6fd0', '#123a75'],
  // parry: green flash + white sparks
  parry: ['#ffffff', '#c8ffd8', '#38e08a', '#12a35c', '#0a5c34'],
  // KO: full-screen fire and ash
  ko: ['#ffffff', '#ffe9a8', '#ff9d3d', '#ff4d2e', '#7a1010', '#3a3a44'],
  // spawn: electric teleport-in
  spawn: ['#ffffff', '#d9f4ff', '#67e8f9', '#22d3ee', '#0e7490'],
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  /** drift toward 0 velocity — sparks vs floaty ash */
  drag: number;
}

export interface PixelFxHandle {
  /** x/y are CSS pixels in the layer's own coordinate space. */
  burst(kind: BurstKind, x: number, y: number, power?: number): void;
  clear(): void;
}

/** Per-kind emission shape. */
function emit(kind: BurstKind, x: number, y: number, power: number): Particle[] {
  const pal = PALETTES[kind];
  const out: Particle[] = [];
  const pick = () => pal[(Math.random() * pal.length) | 0];

  const spray = (
    n: number,
    speed: number,
    spread: number,
    life: number,
    size: () => number,
    gravity = GRAVITY,
    drag = 0.98,
    angle0 = 0,
    arc = Math.PI * 2,
  ) => {
    for (let i = 0; i < n; i++) {
      const a = angle0 + (Math.random() - 0.5) * arc;
      const s = speed * (0.35 + Math.random() * 0.65);
      out.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: life * (0.6 + Math.random() * 0.7),
        size: size(),
        color: pick(),
        gravity,
        drag,
      });
    }
  };

  switch (kind) {
    case 'hit':
      spray(18 * power, 1.9, Math.PI * 2, 22, () => (Math.random() < 0.75 ? 1 : 2));
      break;
    case 'crit':
      // dense core burst + a slower ring of embers
      spray(30 * power, 2.6, Math.PI * 2, 26, () => (Math.random() < 0.5 ? 2 : 3));
      spray(16 * power, 1.1, Math.PI * 2, 46, () => 1, 0.02, 0.99);
      break;
    case 'block':
      // shards fan out sideways off the shield face
      spray(14 * power, 1.6, Math.PI * 0.9, 18, () => (Math.random() < 0.7 ? 1 : 2));
      break;
    case 'parry':
      // tight ring — a deflection, not an explosion
      for (let i = 0; i < 26 * power; i++) {
        const a = (i / (26 * power)) * Math.PI * 2;
        out.push({
          x, y,
          vx: Math.cos(a) * 2.3,
          vy: Math.sin(a) * 2.3,
          life: 0, max: 26, size: 2, color: pick(),
          gravity: 0, drag: 0.93,
        });
      }
      spray(18 * power, 1.4, Math.PI * 2, 30, () => 1, 0.01, 0.97);
      break;
    case 'ko':
      spray(90, 3.4, Math.PI * 2, 40, () => 2 + ((Math.random() * 2) | 0));
      spray(60, 1.3, Math.PI * 2, 80, () => 1, 0.015, 0.995); // slow ash
      spray(30, 4.2, Math.PI * 0.6, 34, () => 2, 0.12, 0.97, -Math.PI / 2, Math.PI * 0.5);
      break;
    case 'spawn':
      // particles converge INTO the sprite: start out on a ring, fly in
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 26 + Math.random() * 18;
        out.push({
          x: x + Math.cos(a) * r,
          y: y + Math.sin(a) * r,
          vx: -Math.cos(a) * 1.8,
          vy: -Math.sin(a) * 1.8,
          life: 0, max: 24, size: 1 + ((Math.random() * 2) | 0), color: pick(),
          gravity: 0, drag: 1.0,
        });
      }
      break;
  }
  return out;
}

export const PixelFx = forwardRef<PixelFxHandle, { className?: string }>(
  function PixelFx({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particles = useRef<Particle[]>([]);
    const raf = useRef<number>(0);
    const dims = useRef({ w: 0, h: 0 }); // low-res backing-store size

    useImperativeHandle(ref, () => ({
      burst(kind, x, y, power = 1) {
        // incoming coords are CSS px; the sim runs in low-res px
        const lx = x / PIXEL_SCALE;
        const ly = y / PIXEL_SCALE;
        const next = emit(kind, lx, ly, power);
        const room = MAX_PARTICLES - particles.current.length;
        if (room <= 0) return;
        particles.current.push(...next.slice(0, room));
      },
      clear() {
        particles.current = [];
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;

      const resize = () => {
        const parent = canvas.parentElement;
        if (!parent) return;
        const w = Math.max(1, Math.floor(parent.clientWidth / PIXEL_SCALE));
        const h = Math.max(1, Math.floor(parent.clientHeight / PIXEL_SCALE));
        if (w === dims.current.w && h === dims.current.h) return;
        dims.current = { w, h };
        canvas.width = w;   // backing store stays tiny — this IS the effect
        canvas.height = h;
        ctx.imageSmoothingEnabled = false;
      };
      resize();

      const ro = new ResizeObserver(resize);
      if (canvas.parentElement) ro.observe(canvas.parentElement);

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const frame = () => {
        const { w, h } = dims.current;
        ctx.clearRect(0, 0, w, h);
        const list = particles.current;
        let alive = 0;

        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          p.life++;
          if (p.life >= p.max) continue;

          p.vy += p.gravity;
          p.vx *= p.drag;
          p.vy *= p.drag;
          p.x += p.vx;
          p.y += p.vy;

          // cull anything that has left the tube
          if (p.x < -8 || p.x > w + 8 || p.y > h + 8) continue;

          // Flicker out over the last third instead of fading the alpha —
          // fading would introduce in-between colours the palette doesn't
          // have. Sprites blink; they don't dissolve.
          const t = p.life / p.max;
          if (t > 0.66 && (p.life & 1)) {
            list[alive++] = p;
            continue;
          }

          ctx.fillStyle = p.color;
          ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size);
          list[alive++] = p;
        }
        list.length = alive;

        raf.current = requestAnimationFrame(frame);
      };

      if (!reduced) raf.current = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf.current);
        ro.disconnect();
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className={`pixelated pointer-events-none absolute inset-0 h-full w-full ${className ?? ''}`}
      />
    );
  },
);
