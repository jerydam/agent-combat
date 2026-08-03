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
 * Full-screen popup menu for mobile: entries stack VERTICALLY with snap,
 * the centred row highlights, and moving between rows plays a short blip
 * — the console-menu feel the game calls for. Tap a row (or tap the
 * already-centred one again) to navigate and close.
 *
 * Vertical because the app is portrait everywhere except the fight: a
 * phone has far more height than width, so a stack shows several full
 * labels at once where a horizontal rail showed one and a half.
 */
export function MobileNavCarousel({ items, onClose }: { items: NavCard[]; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const lastPlayed = useRef(-1);

  // Vertical list: a phone is tall, so stacking gives every entry a full
  // readable row instead of a 132px sliver, and the scroll gesture runs
  // the way the page already scrolls.
  const CARD_H = 68;
  const GAP = 10;
  const STEP = CARD_H + GAP;

  const centerOn = useCallback((idx: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const target = idx * STEP - track.clientHeight / 2 + CARD_H / 2;
    track.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
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
    const mid = track.scrollTop + track.clientHeight / 2;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round((mid - CARD_H / 2) / STEP)));
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
    // fixed, not absolute: the shell is a normal scrolling portrait page
    // now, so an absolutely-positioned overlay would scroll away with it.
    <div className="fixed inset-0 z-[100] flex flex-col bg-background/97 backdrop-blur-md">
      <div className="flex items-center justify-between p-4">
        <span className="font-display text-sm tracking-[0.3em] text-muted-foreground">MENU</span>
        <button onClick={onClose} className="rounded-full border border-border bg-card/70 p-2 text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-3">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="scrollbar-thin flex w-full max-w-sm flex-col items-stretch gap-2.5 overflow-y-auto px-5"
          style={{
            scrollSnapType: 'y mandatory',
            // half-viewport padding top and bottom so the FIRST and LAST
            // entries can still reach the centre line
            paddingTop: 'calc(50% - 34px)',
            paddingBottom: 'calc(50% - 34px)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {items.map((item, idx) => {
            const Icon = item.icon;
            const isCenter = idx === active;
            return (
              <button
                key={item.href}
                onClick={() => select(idx)}
                className={cn(
                  'flex w-full shrink-0 snap-center items-center gap-3.5 rounded-2xl border px-4 transition-all duration-200',
                  isCenter
                    ? 'border-primary bg-primary/15 text-primary shadow-[0_0_30px_hsl(204_95%_53%/0.35)]'
                    : 'border-border bg-card/40 text-muted-foreground opacity-60',
                )}
                style={{ height: CARD_H }}
              >
                <Icon className={cn('shrink-0', isCenter ? 'h-7 w-7' : 'h-5 w-5')} />
                <span className={cn(
                  'font-display font-bold tracking-wide',
                  isCenter ? 'text-base' : 'text-sm',
                )}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        <p className="pb-4 font-display text-[10px] tracking-[0.3em] text-muted-foreground">
          SCROLL · TAP TO ENTER
        </p>
      </div>
    </div>
  );
}