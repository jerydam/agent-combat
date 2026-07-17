'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Immersive game mode:
 * 1. requestFullscreen (hides browser chrome, enables orientation lock)
 * 2. screen.orientation.lock('landscape') — works on Android in fullscreen
 * 3. iOS / unsupported: CSS-rotate the whole game 90° while the device is
 *    held portrait, so the game is ALWAYS landscape regardless of how the
 *    phone is held. Buttons keep working — the browser hit-tests through
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
 * Hook: manages game mode for a screen. Returns:
 * - rotated: apply the CSS-rotation fallback (device portrait, no lock)
 * - containerStyle: style for the game root when rotated
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
