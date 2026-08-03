'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  Award, Coins, Dumbbell, Flame, Gauge, Medal, Plus, Shield, ShoppingBag,
  Swords, Trophy, Users, Wallet, Zap,
} from 'lucide-react';

/**
 * The manual. Everything a player needs, in the order they'll need it.
 *
 * Every number on this page is taken from the actual source of truth —
 * TUNING in backend/app/combat/engine.py, the constants in the
 * contracts, and the reward maths in routers/combat.py. If you retune
 * the game, retune this page in the same commit; a wrong manual is worse
 * than no manual.
 */

interface Section {
  id: string;
  label: string;
  icon: React.ElementType;
}

const SECTIONS: Section[] = [
  { id: 'start', label: 'Getting started', icon: Wallet },
  { id: 'agents', label: 'Your agents', icon: Zap },
  { id: 'combat', label: 'Live combat', icon: Swords },
  { id: 'super', label: 'The super meter', icon: Flame },
  { id: 'staking', label: 'Staking & payouts', icon: Coins },
  { id: 'avatars', label: 'Avatars & market', icon: ShoppingBag },
  { id: 'arena', label: 'Arena (PvP)', icon: Swords },
  { id: 'leagues', label: 'Leagues', icon: Users },
  { id: 'tournaments', label: 'Tournaments', icon: Medal },
  { id: 'progress', label: 'Points & progression', icon: Award },
];

function H({ id, icon: Icon, children }: { id: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex scroll-mt-20 items-center gap-2.5 font-display text-2xl font-bold text-steel">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </h2>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="shrink-0 text-right font-semibold tabular-nums">{v}</span>
    </div>
  );
}

function Card({ title, children, tone = 'default' }: {
  title?: string; children: React.ReactNode; tone?: 'default' | 'warn' | 'good';
}) {
  return (
    <div className={cn('rounded-xl border p-4',
      tone === 'warn' ? 'border-warning/50 bg-warning/5'
        : tone === 'good' ? 'border-success/40 bg-success/5'
          : 'border-border bg-card/40')}>
      {title && <div className="mb-2 font-display text-sm font-bold tracking-wide">{title}</div>}
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

export function GuideView() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-wide text-steel sm:text-3xl">HOW IT ALL WORKS</h1>
        <div className="split-line mt-2 w-40" />
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Agent Arena in full: mint an AI fighter as an NFT on Botchain, level it through
          real-time combat, kit it out, and compete for BOT in solo stakes, duels, leagues
          and tournaments. Everything below is how the game actually behaves — the exact
          numbers the engine and contracts use.
        </p>
      </div>

      <div className="gap-8 lg:grid lg:grid-cols-[200px_1fr]">
        {/* ---------------------------------------------------------- TOC */}
        <nav className="mb-6 lg:mb-0">
          <button
            onClick={() => setOpen((o) => !o)}
            className="mb-2 w-full rounded-lg border border-border px-3 py-2 text-left font-display text-xs tracking-widest text-muted-foreground lg:hidden"
          >
            {open ? 'HIDE CONTENTS' : 'CONTENTS'}
          </button>
          <ul className={cn('space-y-0.5 lg:sticky lg:top-20 lg:block', open ? 'block' : 'hidden')}>
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <a href={`#${s.id}`} onClick={() => setOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <Icon className="h-3.5 w-3.5 shrink-0" /> {s.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-12">

          {/* ================================================== START */}
          <section className="space-y-4">
            <H id="start" icon={Wallet}>Getting started</H>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li><b className="text-foreground">1. Connect a wallet.</b> The game runs on Botchain (chain id 968). The app will prompt you to switch networks.</li>
              <li><b className="text-foreground">2. Get some BOT.</b> You need it for gas, and for staking if you want to play for money. Everything except staking works without it.</li>
              <li><b className="text-foreground">3. Mint an agent</b> at <Link href="/create" className="text-primary hover:underline">Mint Agent</Link>. Minting itself is free — you only pay gas.</li>
              <li><b className="text-foreground">4. Learn the controls</b> at <Link href="/training" className="text-primary hover:underline">Training</Link>. It&apos;s a real fight that <b>pauses itself</b> the moment something is about to happen, tells you which button to press, and only continues once you press it.</li>
              <li><b className="text-foreground">5. Fight</b> at <Link href="/combat" className="text-primary hover:underline">Combat</Link>.</li>
            </ol>
            <Card tone="good" title="You can play for free">
              You do not have to stake anything. Free fights still earn achievement points,
              XP and wins for your agent. Staking is optional and separate.
            </Card>
          </section>

          {/* ================================================= AGENTS */}
          <section className="space-y-4">
            <H id="agents" icon={Zap}>Your agents</H>
            <p className="text-sm text-muted-foreground">
              An agent is an ERC-721 NFT holding its own stats, record and evolution
              tier on-chain. You can own up to <b className="text-foreground">5 per wallet</b>.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Base stats (rolled at mint)">
                <Row k="Attack / Defense / Speed / Intelligence" v="40–90 each" />
                <Row k="Personality bonus" v="+10 to one stat" />
                <p className="pt-2">
                  Stats are rolled pseudo-randomly from the block. Your personality choice
                  adds a guaranteed +10: <b>Aggressive</b> → ATK, <b>Defensive</b> → DEF,
                  {' '}<b>Tactical</b> → INT.
                </p>
              </Card>
              <Card title="What each stat does">
                <Row k="Attack" v="damage dealt" />
                <Row k="Defense" v="damage reduction + max HP" />
                <Row k="Speed" v="wind-up & recovery time" />
                <Row k="Intelligence" v="crit chance, stamina cost, bot reactions" />
              </Card>
            </div>

            <Card title="Levels and evolution">
              <Row k="XP per win / loss" v="40 / 10" />
              <Row k="XP to next level" v="level × 100" />
              <Row k="Max HP" v="100 + (level × 10) + (DEF ÷ 2)" />
              <div className="pt-2 space-y-1.5">
                <div><b className="text-foreground">Tier 1 — Basic.</b> Where every agent starts.</div>
                <div><b className="text-primary">Tier 2 — Advanced (25 wins).</b> Unlocks <b>Counter</b> (parries deal 30% damage back) and <b>Predictive</b> (reads telegraphs 100ms earlier). +5 INT.</div>
                <div><b className="text-accent">Tier 3 — Elite (60 wins).</b> Unlocks <b>Quantum</b> — a 10% chance any block becomes a parry. +5 INT.</div>
              </div>
            </Card>
          </section>

          {/* ================================================= COMBAT */}
          <section className="space-y-4">
            <H id="combat" icon={Swords}>Live combat</H>
            <p className="text-sm text-muted-foreground">
              Real-time, 90 seconds, two buttons. The server owns every rule — your client
              only sends taps, so a modified client gains nothing. Play it in landscape.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Attacking">
                <div><b className="text-foreground">Tap ATK</b> — light attack. Base 12 damage, short wind-up, 12 stamina.</div>
                <div><b className="text-foreground">Hold ATK ~0.4s</b> — heavy attack. Base 22 damage, 1.6× the wind-up, 22 stamina.</div>
                <p className="pt-1">
                  Damage scales with <b>(1 + ATK ÷ 200)</b> and is reduced by the target&apos;s
                  <b> DEF ÷ (DEF + 150)</b>. Crits are 5% + 0.15% per INT, for 1.5× damage.
                </p>
              </Card>
              <Card title="Defending">
                <div><b className="text-foreground">Tap DEF</b> — guard opens for 400ms, then 300ms cooldown.</div>
                <Row k="Blocks a light attack" v="−75% (more with DEF)" />
                <Row k="Blocks a heavy attack" v="−40%" />
                <Row k="Blocks a super" v="−55%" />
                <p className="pt-1 text-warning">
                  Spamming DEF shrinks your guard window by 25% per recent press. Time it,
                  don&apos;t hold it.
                </p>
              </Card>
            </div>

            <Card title="Parry — the highest-value move in the game" tone="good">
              <p>
                If your block opens within <b className="text-success">150ms</b> of the hit landing,
                it becomes a parry instead: <b>zero damage</b>, the attacker is staggered for
                500ms, and you get a free punish. At Tier 2+ you also counter for 30% of the
                damage you just avoided.
              </p>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Stamina">
                <Row k="Pool" v="100" />
                <Row k="Light / heavy / defend / super" v="12 / 22 / 6 / 15" />
                <Row k="Regen" v="9 per sec (14 below 30)" />
                <p className="pt-1 text-warning">
                  Hit zero and you are <b>EXHAUSTED</b> for ~2s: you cannot act, take 25% more
                  damage, and your guard window is halved. High INT shortens it.
                </p>
              </Card>
              <Card title="How a fight is won">
                <div><b className="text-foreground">1. Knockout</b> — drop them to 0 HP. Ends it instantly.</div>
                <div><b className="text-foreground">2. On points</b> — at the 90s bell, higher score wins.</div>
                <div><b className="text-foreground">3. On health</b> — if scores tie, most HP left.</div>
                <div><b className="text-foreground">4. Tiebreak</b> — if still level, higher Speed.</div>
                <div className="pt-2">
                  <Row k="Score formula" v="damage + (defends × 8) + (parries × 20) + (supers × 35)" />
                </div>
              </Card>
            </div>
          </section>

          {/* ================================================== SUPER */}
          <section className="space-y-4">
            <H id="super" icon={Flame}>The super meter</H>
            <Card>
              <p>
                The orange bar under your stamina charges as you fight. When it fills, a third
                button appears mid-screen: <b className="text-warning">SUPER</b>.
              </p>
              <div className="pt-2">
                <Row k="Charge per damage dealt" v="+1.25" />
                <Row k="Charge per damage taken" v="+0.55" />
                <Row k="Charge on a parry / block" v="+12 / +3" />
                <Row k="Super base damage" v="46 (vs 22 heavy)" />
                <Row k="Wind-up" v="900ms — clearly telegraphed" />
                <Row k="Stamina cost" v="15" />
              </div>
              <p className="pt-2">
                You charge it faster by landing hits, but you also charge it slowly by
                <i> taking</i> them — so being beaten down still earns you a comeback button.
              </p>
            </Card>
            <Card tone="warn" title="A super is not unstoppable">
              Its 900ms wind-up is the longest telegraph in the game, and it exists so the
              defender can answer it. Blocking a super cuts it by 55%. A perfectly timed
              <b> parry cancels it outright</b>, staggers the attacker for 1.1 seconds and
              counters for 45%. Throwing one blind against a good player is a gift.
            </Card>
          </section>

          {/* ================================================ STAKING */}
          <section className="space-y-4">
            <H id="staking" icon={Coins}>Staking &amp; payouts</H>
            <Card>
              <p>
                In <Link href="/combat" className="text-primary hover:underline">Combat</Link> you can
                stake BOT on a fight against the house AI. Your stake is escrowed in the
                SoloArena contract before the fight starts.
              </p>
              <div className="pt-2">
                <Row k="Win" v="1.8× your stake, paid automatically" />
                <Row k="Lose" v="stake goes to the house" />
                <Row k="Max stake" v="limited by the prize pool" />
              </div>
            </Card>
            <Card tone="warn" title="If a fight never gets a result">
              Your stake is never stuck. If the server fails to settle a fight, the result is
              saved and retried automatically — and after <b>1 hour</b> you can pull the stake
              back yourself from the{' '}
              <Link href="/rewards" className="text-warning hover:underline">Rewards</Link> page.
              That page is also where you see everything you&apos;re owed and everything already paid.
            </Card>
          </section>

          {/* ================================================ AVATARS */}
          <section className="space-y-4">
            <H id="avatars" icon={ShoppingBag}>Avatars, boosts &amp; powers</H>
            <p className="text-sm text-muted-foreground">
              The <Link href="/market" className="text-primary hover:underline">Market</Link> sells three
              different things. Pay with achievement points or BOT —{' '}
              <b className="text-foreground">1,000 points = $1</b> of BOT, same value either way.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <Card title="Avatars (skins)">
                Not cosmetic. Each one changes hit power, defence, attack speed, crit,
                parry window, stamina regen, max HP and super charge rate — scaled to
                what it costs.
              </Card>
              <Card title="Powers">
                Equippable perks, one active per agent. Stack with your avatar rather
                than replacing it.
              </Card>
              <Card title="Boosts">
                Consumed to write <b>permanent stat points on-chain</b> to one agent.
                One-time use.
              </Card>
            </div>

            <Card title="Avatar tiers — what the money buys">
              <p className="pb-2">
                Measured over 1,400 simulated fights per avatar against an opponent with no
                avatar equipped:
              </p>
              <Row k="Common (600–800 pts)" v="+0 to +2% win rate" />
              <Row k="Uncommon (1,000–1,200)" v="+1 to +3%" />
              <Row k="Rare (1,500–2,000)" v="+2 to +8%" />
              <Row k="Epic (2,500–3,500)" v="+5 to +11%" />
              <Row k="Legendary (4,000)" v="+13%" />
              <p className="pt-2">
                Each avatar has a personality, not just bigger numbers — Berserker hits
                hardest but takes more damage; Titan is armoured but swings slower. The best
                avatar turns a coin flip into roughly 2:1, so it&apos;s worth paying for, but a
                better player on a cheap avatar still beats a worse one on an expensive one.
              </p>
            </Card>

            <Card tone="warn" title="One copy, one agent">
              A purchased avatar or power can only be worn by <b>one agent at a time</b>.
              Equipping it on a second agent moves it — it is taken off the first. Buying one
              Legendary does not buff your whole roster.
            </Card>
          </section>

          {/* ================================================== ARENA */}
          <section className="space-y-4">
            <H id="arena" icon={Swords}>Arena — fighting other players</H>
            <p className="text-sm text-muted-foreground">
              <Link href="/arena" className="text-primary hover:underline">Arena</Link> holds two
              genuinely different things. Both are PvP; only one is played with your hands.
            </p>

            <Card tone="good" title="Live PvP — real-time, you play it">
              <p>
                You and another human in the same 90-second fight, on the same authoritative
                server, both tapping your own attacks, blocks, parries and supers. Your
                agent&apos;s stats and equipped avatar apply exactly as they do against the AI.
              </p>
              <div className="pt-2">
                <Row k="Find opponent" v="open queue, first match wins" />
                <Row k="Play a friend" v="both enter the same room code" />
                <Row k="Reward" v="points + XP for both, more for the winner" />
                <Row k="Stakes" v="none yet — this is for ranking, not wagers" />
              </div>
              <p className="pt-2">
                If your opponent disconnects mid-round, their agent is handed to the AI and
                you&apos;re told — the fight always finishes.
              </p>
            </Card>

            <Card tone="warn" title="Simulated duels — you set it up, the engine plays it">
              These are the challenge / quick-match battles further down the Arena page. Both
              agents are resolved by the deterministic engine from a seed fixed on-chain, and
              the result is submitted with a hash of the full replay. You choose the matchup
              and the wager; nobody taps a button. This is the one that supports BOT wagers,
              and the one to use against players who are offline.
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Quick Match — free, instant">
                <p>
                  Pick an opponent and fight immediately. No stake, no waiting for consent.
                </p>
                <p className="pt-1 text-warning">
                  The target&apos;s owner must have opted in first. If you get
                  &quot;opponent may not have quick-match enabled&quot;, that&apos;s why. Enable it
                  on your own agents so others can fight you.
                </p>
              </Card>
              <Card title="Challenge — optional wager">
                <p>
                  Post a challenge against a specific agent with a BOT stake. The other player
                  must <b>accept</b> and match it. Winner takes the pot minus a 2.5% fee.
                </p>
                <p className="pt-1">
                  The random seed is fixed at <i>accept</i>, not at challenge — so neither side
                  (nor the backend) can pre-compute the outcome before committing money.
                </p>
              </Card>
            </div>
          </section>

          {/* ================================================ LEAGUES */}
          <section className="space-y-4">
            <H id="leagues" icon={Users}>Leagues</H>
            <Card>
              <p>
                A <b className="text-foreground">scheduled, asynchronous round-robin</b> — think of it as a
                season with your friends.
              </p>
              <div className="pt-2">
                <Row k="Who creates it" v="anyone" />
                <Row k="Access" v="public, or private via join code" />
                <Row k="Format" v="double round-robin (everyone twice)" />
                <Row k="When you play" v="any time inside the window" />
                <Row k="Minimum players" v="3" />
                <Row k="Prizes" v="50 / 30 / 20 %, minus 5% fee" />
              </div>
              <p className="pt-2">
                You create a room with an entry fee, a start time, an end time and an optional
                code. Players join before it starts. During the window <b>you trigger your own
                fixtures</b> whenever you like. After the end time the backend forfeits anything
                unplayed, computes the table and submits final standings on-chain.
              </p>
            </Card>
          </section>

          {/* ============================================ TOURNAMENTS */}
          <section className="space-y-4">
            <H id="tournaments" icon={Medal}>Tournaments</H>
            <Card>
              <p>
                A <b className="text-foreground">single-elimination bracket</b>, resolved in one shot.
              </p>
              <div className="pt-2">
                <Row k="Format" v="knockout bracket" />
                <Row k="When you play" v="you don't — it runs itself" />
                <Row k="Entry" v="pay the fee before registration closes" />
                <Row k="Prizes" v="50 / 30 / 20 %, minus 5% fee" />
              </div>
              <p className="pt-2">
                Enter before the deadline. When it starts, a bracket seed is fixed on-chain,
                the backend derives the whole bracket and every match seed from it, simulates
                every round, and submits the podium. One entry, one result, no scheduling.
              </p>
            </Card>

            <Card title="League vs Tournament — the short version" tone="good">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 font-display">&nbsp;</th>
                      <th className="py-1.5 pr-3 font-display">League</th>
                      <th className="py-1.5 font-display">Tournament</th>
                    </tr>
                  </thead>
                  <tbody className="text-foreground">
                    {[
                      ['Shape', 'Round-robin season', 'Knockout bracket'],
                      ['Duration', 'Days — a start/end window', 'Instant once it starts'],
                      ['You play', 'Your fixtures, when you want', 'Nothing — fully automatic'],
                      ['Lose once', 'Keep playing', "You're out"],
                      ['Hosted by', 'Anyone can create one', 'Run by the game'],
                      ['Private?', 'Yes — join codes', 'No, open entry'],
                    ].map(([k, l, t]) => (
                      <tr key={k} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-3 text-muted-foreground">{k}</td>
                        <td className="py-1.5 pr-3">{l}</td>
                        <td className="py-1.5">{t}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card tone="warn" title="Your money is never trapped">
              Both leagues and tournaments refund entrants in full if the event never fills,
              never starts, or fails to resolve within 48 hours.
            </Card>
          </section>

          {/* =============================================== PROGRESS */}
          <section className="space-y-4">
            <H id="progress" icon={Award}>Points, achievements &amp; ranking</H>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Points from fighting">
                <Row k="Win" v="50 + (score ÷ 10)" />
                <Row k="Loss" v="score ÷ 20" />
                <p className="pt-1">
                  Earned on every combat fight with a connected wallet, staked or not. Points
                  are wallet-level currency and spend in the Market.
                </p>
              </Card>
              <Card title="Achievements">
                <p>
                  14 goals covering minting, wins, levels, ELO, leagues and staked duels. Each
                  shows a live progress bar. Satisfying one makes it claimable for a points
                  payout at{' '}
                  <Link href="/achievements" className="text-primary hover:underline">Achievements</Link>.
                </p>
              </Card>
            </div>
            <Card title="Ranking (ELO)">
              Agents start at 1000 and move on resolved arena battles using standard ELO
              (K-factor 32). The{' '}
              <Link href="/leaderboard" className="text-primary hover:underline">Leaderboard</Link> ranks
              by this, not by raw win count.
            </Card>
          </section>

          {/* ---------------------------------------------------- CTA */}
          <section className="rounded-2xl border border-primary/40 bg-vs-split p-6 text-center">
            <h2 className="font-display text-xl font-bold text-steel">Ready?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              If you&apos;ve never played, do the training first — it takes a couple of minutes
              and it&apos;s the difference between mashing and parrying.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link href="/training"
                className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary/15 px-4 py-2 font-display text-sm tracking-widest text-primary">
                <Dumbbell className="h-4 w-4" /> TRAINING
              </Link>
              <Link href="/create"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 font-display text-sm tracking-widest text-muted-foreground">
                <Plus className="h-4 w-4" /> MINT AN AGENT
              </Link>
              <Link href="/combat"
                className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent/15 px-4 py-2 font-display text-sm tracking-widest text-accent">
                <Swords className="h-4 w-4" /> FIGHT
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
