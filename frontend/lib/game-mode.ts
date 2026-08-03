'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Immersive game mode — used by the COMBAT SCREEN ONLY.
 *
 * Every other page in the app is a normal portrait document: it scrolls,
 * it follows the device orientation, and it must never be touched by any
 * of this. Only the live fight is landscape, because that is the only
 * screen whose layout genuinely needs the width (two fighters + HUD +
 * thumb buttons on the outer edges).
 *
 * How landscape is achieved, in order of preference:
 * 1. requestFullscreen (hides browser chrome, and is a precondition for
 *    orientation.lock on Android)
 * 2. screen.orientation.lock('landscape')
 * 3. iOS / unsupported: CSS-rotate the game 90° while the device is held
 *    portrait, so the fight is ALWAYS landscape however the phone is
 *    held. Buttons keep working — the browser hit-tests through
 *    transforms.
 */

export async function enterGameMode(el?: HTMLElement): Promise<boolean> {
  let locked = false;
  try {
    const target = el ?? document.documentElement;
    if (!document.fullscreenElement && target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' } as any);
    }
  } catch {
    /* fullscreen denied — fine */
  }
  try {
    const o: any = screen.orientation;
    if (o?.lock) {
      await o.lock('landscape');
      locked = true;
    }
  } catch {
    /* lock unsupported (iOS) — CSS fallback takes over */
  }
  return locked;
}

export async function exitGameMode(): Promise<void> {
  try {
    (screen.orientation as any)?.unlock?.();
  } catch {}
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {}
}

/**
 * Fire-and-forget unlock for non-game screens. Safe to call on every
 * route change: it is a no-op when nothing is locked, and it guarantees a
 * fight that locked landscape can't leave the rest of the app sideways.
 */
export function releaseGameMode(): void {
  if (typeof window === 'undefined') return;
  void exitGameMode();
}

/**
 * Hook: manages landscape game mode for the combat screen. Returns:
 * - rotated: apply the CSS-rotation fallback (device portrait, no lock)
 * - containerStyle: style for the game root
 * - activate(): call from a user gesture (button press) to try
 *   fullscreen+lock — browsers require a gesture for both.
 */
export function useLandscapeGameMode() {
  const [rotated, setRotated] = useState(false);
  const lockedRef = useRef(false);

  const evaluate = useCallback(() => {
    if (typeof window === 'undefined') return;
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches; // touch device
    setRotated(portrait && coarse && !lockedRef.current);
  }, []);

  const activate = useCallback(async () => {
    lockedRef.current = await enterGameMode();
    evaluate();
  }, [evaluate]);

  useEffect(() => {
    evaluate();
    const mq = window.matchMedia('(orientation: portrait)');
    const onChange = () => evaluate();
    mq.addEventListener?.('change', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      mq.removeEventListener?.('change', onChange);
      window.removeEventListener('resize', onChange);
      lockedRef.current = false;
      exitGameMode();
    };
  }, [evaluate]);

  const containerStyle: React.CSSProperties = rotated
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vh',
        height: '100vw',
        transform: 'rotate(90deg) translateY(-100%)',
        transformOrigin: 'top left',
      }
    : { position: 'fixed', inset: 0 };

  return { rotated, containerStyle, activate };
}
