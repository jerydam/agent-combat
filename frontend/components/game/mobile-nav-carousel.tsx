'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export interface NavCard {
  href: string;
  label: string;
  icon: React.ElementType;
}

/** Short ascending blip — console-menu style tick when the centered card
 * changes, and a slightly brighter one on select. No assets, no deps. */
function beep(freq: number, ms: number) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
    osc.onended = () => ctx.close().catch(() => {});
  } catch { /* audio unavailable — silent, never blocks navigation */ }
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * Full-screen popup menu for mobile: cards scroll horizontally with
 * snap, the centered card scales up, and moving between cards plays a
 * short blip — the console-menu feel the game calls for. Tap a card (or
 * tap the already-centered one again) to navigate and close.
 */
export function MobileNavCarousel({ items, onClose }: { items: NavCard[]; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const lastPlayed = useRef(-1);

  const CARD_W = 132;
  const GAP = 14;
  const STEP = CARD_W + GAP;

  const centerOn = useCallback((idx: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const target = idx * STEP - track.clientWidth / 2 + CARD_W / 2;
    track.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
  }, [STEP]);

  // start centered on the current page
  useEffect(() => {
    const startIdx = Math.max(0, items.findIndex((i) => isActivePath(pathname ?? '', i.href)));
    setActive(startIdx);
    lastPlayed.current = startIdx;
    const t = setTimeout(() => centerOn(startIdx, false), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const mid = track.scrollLeft + track.clientWidth / 2;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round((mid - CARD_W / 2) / STEP)));
    if (idx !== active) setActive(idx);
    if (idx !== lastPlayed.current) {
      beep(340 + idx * 6, 45);
      lastPlayed.current = idx;
    }
  }, [active, items.length, STEP]);

  const select = (idx: number) => {
    if (idx !== active) { setActive(idx); centerOn(idx); return; }
    beep(520, 90);
    router.push(items[idx].href);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[100] flex flex-col bg-background/97 backdrop-blur-md">
      <div className="flex items-center justify-between p-4">
        <span className="font-display text-sm tracking-[0.3em] text-muted-foreground">MENU</span>
        <button onClick={onClose} className="rounded-full border border-border bg-card/70 p-2 text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="scrollbar-thin flex w-full snap-x snap-mandatory items-center gap-3.5 overflow-x-auto px-[calc(50%-66px)] py-6"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {items.map((item, idx) => {
            const Icon = item.icon;
            const isCenter = idx === active;
            return (
              <button
                key={item.href}
                onClick={() => select(idx)}
                className={cn(
                  'flex shrink-0 snap-center flex-col items-center justify-center gap-2 rounded-2xl border transition-all duration-200',
                  isCenter
                    ? 'h-36 w-32 scale-100 border-primary bg-primary/15 text-primary shadow-[0_0_30px_hsl(204_95%_53%/0.35)]'
                    : 'h-28 w-32 scale-90 border-border bg-card/40 text-muted-foreground opacity-60',
                )}
                style={{ width: CARD_W }}
              >
                <Icon className={cn(isCenter ? 'h-8 w-8' : 'h-6 w-6')} />
                <span className={cn('font-display font-bold tracking-wide', isCenter ? 'text-sm' : 'text-xs')}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        <p className="font-display text-[10px] tracking-[0.3em] text-muted-foreground">
          SCROLL · TAP TO ENTER
        </p>
      </div>
    </div>
  );
}