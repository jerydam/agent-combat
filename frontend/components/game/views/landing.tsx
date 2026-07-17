'use client';

import { useWallet } from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { Swords, Zap, Trophy, Brain, Sparkles, ChevronRight, Wallet, Shield, Cpu } from 'lucide-react';

interface LandingViewProps {
  onEnter: () => void;
}

export function LandingView({ onEnter }: LandingViewProps) {
  const { connect, connecting } = useWallet();

  const handleConnect = async () => {
    await connect();
    onEnter();
  };

  return (
    <div className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-b from-card/80 to-background/40 px-6 py-20 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/20 blur-[100px]" />

        <div className="relative">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Live on BOT Chain
          </div>

          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <img
              src="/logo.png"
              alt="Agent Combat"
              className="h-40 w-40 sm:h-52 sm:w-52 drop-shadow-[0_0_40px_rgba(20,184,166,0.3)]"
              draggable={false}
            />
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Create, train, and battle autonomous AI-powered NFT agents. A living onchain
            ecosystem where agents learn, evolve, and compete for reputation.
          </p>

          <div className="mx-auto mt-10 max-w-sm">
            <Button
              onClick={handleConnect}
              disabled={connecting}
              size="lg"
              className="w-full gap-2 text-base animate-pulse-glow"
            >
              {connecting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Connecting wallet…
                </>
              ) : (
                <>
                  <Wallet className="h-5 w-5" />
                  Connect Wallet to Enter
                  <ChevronRight className="h-5 w-5" />
                </>
              )}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              MetaMask or any injected wallet · auto-switches to BOT Chain (677)
            </p>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Cpu,
            title: 'Mint AI Agents',
            desc: 'Each agent is a unique NFT with attributes, personality, and rarity. No two are alike.',
            color: 'text-primary',
          },
          {
            icon: Brain,
            title: 'AI Battle Engine',
            desc: 'Personality-driven combat. Aggressive, defensive, calculating — each agent fights differently.',
            color: 'text-accent',
          },
          {
            icon: Zap,
            title: 'Train & Evolve',
            desc: 'Win battles, earn XP, unlock skills, and evolve your agent through tiers.',
            color: 'text-warning',
          },
          {
            icon: Trophy,
            title: 'Compete Onchain',
            desc: 'Climb the leaderboard. Results recorded on BOT Chain for permanent reputation.',
            color: 'text-success',
          },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="group rounded-2xl border border-border/60 bg-card/40 p-6 transition-all hover:border-primary/40 hover:bg-card/70 hover:shadow-[0_0_24px_rgba(20,184,166,0.1)]"
            >
              <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-secondary ${f.color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-base font-bold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          );
        })}
      </section>

      {/* How it works */}
      <section className="mt-12 rounded-2xl border border-border/60 bg-card/40 p-8">
        <h2 className="font-display text-2xl font-bold text-foreground">How It Works</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: '01', title: 'Connect & Create Profile', icon: Wallet },
            { step: '02', title: 'Mint Your First Agent NFT', icon: Shield },
            { step: '03', title: 'Train & Enter the Arena', icon: Swords },
            { step: '04', title: 'Win, Evolve & Dominate', icon: Trophy },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.step} className="relative">
                <div className="mb-3 flex items-center gap-3">
                  <span className="font-display text-3xl font-black text-primary/30">{s.step}</span>
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display text-sm font-semibold text-foreground">{s.title}</h3>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}