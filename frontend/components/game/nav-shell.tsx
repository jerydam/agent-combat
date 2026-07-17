'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useWallet, shortAddr } from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { Zap, Swords, Trophy, Home, Plus, Dumbbell, LogOut, Wallet, Bot, Users, Medal, Flame, Award, ShoppingBag } from 'lucide-react';
import { Toaster } from 'sonner';

const NAV_ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/dashboard', label: 'My Agents', icon: Zap },
  { href: '/create', label: 'Mint Agent', icon: Plus },
  { href: '/arena', label: 'Arena', icon: Swords },
  { href: '/combat', label: 'Combat', icon: Flame },
  { href: '/training', label: 'Training', icon: Dumbbell },
  { href: '/solo', label: 'Solo', icon: Bot },
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

export function NavShell({ children }: { children: React.ReactNode }) {
  const { connected, address, connect, connecting, disconnect } = useWallet();
  const pathname = usePathname();

  // Game screens are fully immersive: no header, no bottom nav, no padding.
  const GAME_SCREENS = ['/combat'];
  if (GAME_SCREENS.some((p) => pathname?.startsWith(p))) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-screen bg-background bg-arena">
      <div className="pointer-events-none fixed inset-0 bg-grid opacity-30" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      <header className="sticky top-0 z-40 border-b border-border/60 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[0_0_18px_rgba(20,184,166,0.4)]">
              <Swords className="h-5 w-5" />
            </div>
            <div className="text-left leading-none">
              <div className="font-display text-lg font-bold tracking-wider text-foreground">
                AGENT<span className="text-primary">ARENA</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Onchain AI Battles
              </div>
            </div>
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

        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-2 md:hidden scrollbar-thin">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
      <Toaster theme="dark" position="bottom-right" />

      <footer className="relative z-10 border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        Agent Arena — Autonomous AI agents competing on Botchain
      </footer>
    </div>
  );
}
