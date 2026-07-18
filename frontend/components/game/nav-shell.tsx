'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useWallet, shortAddr } from '@/lib/wallet';
import { api } from '@/lib/api';
import { useLandscapeGameMode } from '@/lib/game-mode';
import { MobileNavCarousel } from '@/components/game/mobile-nav-carousel';
import { Button } from '@/components/ui/button';
import { Star } from 'lucide-react';
import { Zap, Swords, Trophy, Home, Plus, Dumbbell, LogOut, Wallet, Users, Medal, Flame, Award, ShoppingBag, Menu } from 'lucide-react';
import { Toaster } from 'sonner';

const NAV_ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/dashboard', label: 'My Agents', icon: Zap },
  { href: '/create', label: 'Mint Agent', icon: Plus },
  { href: '/arena', label: 'Arena', icon: Swords },
  { href: '/combat', label: 'Combat', icon: Flame },
  { href: '/training', label: 'Training', icon: Dumbbell },
  { href: '/leagues', label: 'Leagues', icon: Users },
  { href: '/tournaments', label: 'Tournaments', icon: Medal },
  { href: '/achievements', label: 'Achievements', icon: Award },
  { href: '/market', label: 'Market', icon: ShoppingBag },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/** Coarse pointer + narrow viewport = phone/tablet, our "mobile" mode. */
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse) and (max-width: 900px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return mobile;
}

export function NavShell({ children }: { children: React.ReactNode }) {
  const { connected, address, connect, connecting, disconnect } = useWallet();
  const pathname = usePathname();
  const [points, setPoints] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const { rotated, containerStyle, activate } = useLandscapeGameMode();
  const [showMenu, setShowMenu] = useState(false);
  const [everConnected, setEverConnected] = useState(false);

  useEffect(() => {
    if (!connected || !address) { setPoints(null); return; }
    let live = true;
    api.inventory(address).then((i) => live && setPoints(i.points)).catch(() => {});
    return () => { live = false; };
  }, [connected, address, pathname]);

  // Mobile: the carousel menu IS the navigation. Pop it up once, right
  // after the wallet connects, so there's never a bare screen with no
  // way to get anywhere — after that it's reachable via the MENU button.
  useEffect(() => {
    if (isMobile && connected && !everConnected) {
      setEverConnected(true);
      setShowMenu(true);
    }
    if (!connected) setEverConnected(false);
  }, [isMobile, connected, everConnected]);

  // Landscape lock needs a user gesture; piggyback on Connect / MENU taps.
  const handleConnect = async () => {
    if (isMobile) await activate();
    connect();
  };
  const openMenu = async () => {
    if (isMobile && !rotated) await activate();
    setShowMenu(true);
  };

  // Game screens are fully immersive: they manage their own chrome and
  // landscape lock (see combat.tsx), so the shell gets entirely out of
  // the way — same on desktop and mobile.
  const GAME_SCREENS = ['/combat'];
  if (GAME_SCREENS.some((p) => pathname?.startsWith(p))) {
    return <>{children}</>;
  }

  if (isMobile) {
    return (
      <div className="relative min-h-screen bg-background bg-arena" style={{ ...containerStyle, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div className="pointer-events-none fixed inset-0 bg-grid opacity-30" />
        <div className="pointer-events-none fixed inset-x-0 top-0 z-40 split-line" />

        {/* slim strip: logo + wallet only — no link list, the carousel is the nav */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 glass px-3">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-8 w-8" draggable={false} />
          </Link>
          <div className="flex items-center gap-2">
            {points !== null && (
              <div className="split-ring flex items-center gap-1 rounded-lg px-2 py-1 font-display text-[11px] font-bold text-warning">
                <Star className="h-3 w-3" /> {points.toLocaleString()}
              </div>
            )}
            {connected ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                  <Wallet className="h-3.5 w-3.5" />
                </div>
                <button onClick={disconnect} className="text-muted-foreground"><LogOut className="h-4 w-4" /></button>
              </>
            ) : (
              <Button size="sm" onClick={handleConnect} disabled={connecting} className="gap-1.5">
                <Wallet className="h-4 w-4" />
                {connecting ? 'Connecting…' : 'Connect'}
              </Button>
            )}
          </div>
        </header>

        <main className="relative z-10 px-4 pb-24 pt-6">
          {connected ? children : (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <img src="/logo.png" alt="" className="h-16 w-16 opacity-80" draggable={false} />
              <p className="max-w-xs text-sm text-muted-foreground">
                Connect your wallet to enter the arena.
              </p>
              <Button size="lg" onClick={handleConnect} disabled={connecting}
                className="animate-pulse-glow font-display tracking-widest">
                <Wallet className="mr-2 h-4 w-4" />
                {connecting ? 'CONNECTING…' : 'GET STARTED'}
              </Button>
            </div>
          )}
        </main>

        {/* floating MENU trigger — the only way back to the carousel */}
        {connected && (
          <button
            onClick={openMenu}
            className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary/60 bg-card/90 text-primary shadow-[0_0_24px_hsl(204_95%_53%/0.4)] backdrop-blur"
          >
            <Menu className="h-6 w-6" />
          </button>
        )}

        {showMenu && (
          <MobileNavCarousel items={NAV_ITEMS} onClose={() => setShowMenu(false)} />
        )}

        <Toaster theme="dark" position="top-center" />
      </div>
    );
  }

  // ------------------------------------------------------------- desktop
  return (
    <div className="relative min-h-screen bg-background bg-arena">
      <div className="pointer-events-none fixed inset-0 bg-grid opacity-30" />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 split-line" />

      <header className="sticky top-0 z-40 border-b border-border/60 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              className="h-10 w-10 drop-shadow-[0_0_12px_hsl(204_95%_53%/0.45)]"
              draggable={false}
            />
            <span className="hidden font-display text-sm font-black tracking-widest lg:block">
              <span className="text-primary">äGENT</span>{' '}
              <span className="text-accent">çOMBAT</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {connected ? (
              <div className="flex items-center gap-2">
                {points !== null && (
                  <Link href="/achievements"
                    className="split-ring flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-display text-xs font-bold text-warning">
                    <Star className="h-3.5 w-3.5" /> {points.toLocaleString()}
                  </Link>
                )}
                <div className="hidden text-right sm:block">
                  <div className="text-xs font-semibold text-foreground">Connected</div>
                  <div className="text-[10px] text-muted-foreground">{shortAddr(address)}</div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                  <Wallet className="h-4 w-4" />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={disconnect}
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  title="Disconnect"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => connect()} disabled={connecting} className="gap-1.5">
                <Wallet className="h-4 w-4" />
                {connecting ? 'Connecting…' : 'Connect'}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
      <Toaster theme="dark" position="bottom-right" />

      <footer className="relative z-10 border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        <img src="/logo.png" alt="" className="mx-auto mb-2 h-6 w-6 opacity-60" draggable={false} />
        <div className="split-line mx-auto mb-3 w-24 opacity-70" />
        Agent Combat — Autonomous AI agents competing on Botchain
      </footer>
    </div>
  );
}