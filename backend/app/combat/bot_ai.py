"""Bot tap AI — the personality engine, real-time edition.

The same three personalities that drive turn-based simulation now decide
WHEN to tap. Bots perceive the opponent's wind-up only after a human-like
reaction delay (scaled by intelligence and the Predictive Attack
ability), so parries are earned, not scripted.

Used for: solo house bots, offline league opponents, and disconnect
takeover in live matches.
"""

from __future__ import annotations

import random

from .engine import TUNING, CombatMatch

# reaction delay ms by personality (before INT reduction)
BASE_REACTION = {0: 300, 1: 220, 2: 250}  # aggressive / defensive / tactical
DECISION_CADENCE_MS = 120  # how often the bot thinks


class BotController:
    def __init__(self, match: CombatMatch, who: int, seed: int | None = None):
        self.m = match
        self.who = who
        self.rng = random.Random(seed)
        self.next_think = 0.0
        self.seen_windup_at: float | None = None
        self.react_at: float | None = None
        self.opp_intervals: list[float] = []  # tactical: rhythm reading
        self.last_opp_attack: float | None = None

    # ----------------------------------------------------------- perception

    def _reaction_ms(self) -> float:
        me = self.m.f[self.who]
        base = BASE_REACTION[me.stats.personality.value]
        base -= me.stats.intelligence * 0.6
        if me.has_predictive:
            base -= 100  # telegraphs read earlier
        return max(80.0, base + self.rng.uniform(-30, 30))

    def _observe(self) -> None:
        opp = self.m.f[1 - self.who]
        now = self.m.t
        if opp.phase == "windup":
            if self.seen_windup_at is None:
                self.seen_windup_at = now
                self.react_at = now + self._reaction_ms()
                if self.last_opp_attack is not None:
                    self.opp_intervals.append(now - self.last_opp_attack)
                    self.opp_intervals = self.opp_intervals[-6:]
                self.last_opp_attack = now
        else:
            self.seen_windup_at = None
            self.react_at = None

    # ------------------------------------------------------------- thinking

    def update(self) -> None:
        """Call every server tick."""
        m, now = self.m, self.m.t
        if m.over:
            return
        self._observe()
        me = m.f[self.who]
        opp = m.f[1 - self.who]

        # Reactive defense: if we've registered the wind-up and the hit is
        # coming, try to time the block near impact (that's how parries
        # happen naturally).
        if (
            self.react_at is not None
            and now >= self.react_at
            and opp.phase == "windup"
        ):
            time_to_impact = opp.phase_ends_at - now
            p = me.stats.personality.value
            defend_chance = {0: 0.35, 1: 0.8, 2: 0.65}[p]
            # tactical waits to block close to impact for the parry
            trigger = (
                time_to_impact <= TUNING["parry_window_ms"] * (1.4 if p == 2 else 2.2)
            )
            if trigger and self.rng.random() < defend_chance:
                m.input_defend(self.who)
                self.react_at = None
                return

        if now < self.next_think:
            return
        self.next_think = now + DECISION_CADENCE_MS + self.rng.uniform(0, 60)

        if me.phase != "idle" or me.is_exhausted(now) or now < me.staggered_until:
            return

        p = me.stats.personality.value
        stam = me.stamina

        if p == 0:  # aggressive: pressure, punish stagger, heavy often
            if now < opp.staggered_until or opp.is_exhausted(now):
                m.input_attack(self.who, "heavy")
            elif stam > 28 and self.rng.random() < 0.55:
                kind = "heavy" if self.rng.random() < 0.3 else "light"
                m.input_attack(self.who, kind)

        elif p == 1:  # defensive: conserve, punish after defends
            just_defended = any(
                e.get("kind") in ("blocked", "parry") and e.get("who") == self.who
                for e in m.log[-4:]
            )
            if now < opp.staggered_until:
                m.input_attack(self.who, "heavy")
            elif just_defended and stam > 35:
                m.input_attack(self.who, "light")
            elif stam > 60 and opp.phase == "cooldown" and self.rng.random() < 0.5:
                m.input_attack(self.who, "light")

        else:  # tactical: read rhythm, strike between opponent swings
            if now < opp.staggered_until or opp.is_exhausted(now):
                m.input_attack(self.who, "heavy")
                return
            avg = (
                sum(self.opp_intervals) / len(self.opp_intervals)
                if len(self.opp_intervals) >= 2
                else None
            )
            in_gap = opp.phase == "cooldown" or (
                avg is not None
                and self.last_opp_attack is not None
                and (now - self.last_opp_attack) < avg * 0.55
            )
            if in_gap and stam > 30 and self.rng.random() < 0.6:
                kind = "heavy" if stam > 55 and self.rng.random() < 0.35 else "light"
                m.input_attack(self.who, kind)
