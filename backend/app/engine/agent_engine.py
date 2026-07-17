"""Agent decision engine.

Each agent picks a move per round based on its personality, stats, and what
it observes about the opponent. Everything is a pure function of the battle
RNG (seeded on-chain), so any battle can be replayed and audited from its
seed — the backend cannot invent outcomes.

Phase 2 swaps `PersonalityPolicy` for learned policies (LLM / RL) without
touching the simulator: the interface is just `decide(ctx) -> Move`.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum


class Move(str, Enum):
    STRIKE = "strike"
    POWER_STRIKE = "power_strike"
    GUARD = "guard"
    ANALYZE = "analyze"
    FINISHER = "finisher"


class Personality(int, Enum):
    AGGRESSIVE = 0
    DEFENSIVE = 1
    TACTICAL = 2


# Move economy: (energy_cost, base_damage, accuracy)
MOVE_TABLE: dict[Move, tuple[int, int, float]] = {
    Move.STRIKE: (10, 12, 0.95),
    Move.POWER_STRIKE: (30, 26, 0.80),
    Move.GUARD: (0, 0, 1.0),
    Move.ANALYZE: (5, 0, 1.0),
    Move.FINISHER: (45, 40, 0.70),
}

MAX_FOCUS = 3
FINISHER_HP_THRESHOLD = 0.35


class Ability(str, Enum):
    """Evolution-tier abilities (tier is on-chain; engine maps tier -> set).

    Tier 2 (Advanced): PREDICTIVE_ATTACK, COUNTER_ATTACK
    Tier 3 (Elite):    + QUANTUM_DEFENSE
    """

    PREDICTIVE_ATTACK = "predictive_attack"  # sharper reads, bonus dmg on read
    COUNTER_ATTACK = "counter_attack"        # reflect 30% of blocked damage
    QUANTUM_DEFENSE = "quantum_defense"      # 10% full negate while guarding


def abilities_for_tier(tier: int) -> frozenset[Ability]:
    if tier >= 3:
        return frozenset(
            {Ability.PREDICTIVE_ATTACK, Ability.COUNTER_ATTACK,
             Ability.QUANTUM_DEFENSE}
        )
    if tier == 2:
        return frozenset({Ability.PREDICTIVE_ATTACK, Ability.COUNTER_ATTACK})
    return frozenset()


@dataclass
class FighterState:
    """Mutable in-battle state, initialized from on-chain stats."""

    token_id: int
    name: str
    personality: Personality
    attack: int
    defense: int
    speed: int
    intelligence: int
    level: int
    tier: int = 1
    # Agent memory: prior record vs this exact opponent (from past battles).
    # (my_wins, my_losses) — must be embedded in the battle log inputs so
    # replays stay reproducible.
    memory_vs_opponent: tuple[int, int] = (0, 0)

    hp: int = 0
    max_hp: int = 0
    energy: int = 100
    focus: int = 0  # ANALYZE stacks: +8% dmg, +5% accuracy each
    guarding: bool = False
    last_moves: list[Move] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.max_hp = 100 + self.level * 10 + self.defense // 2
        self.hp = self.max_hp

    @property
    def abilities(self) -> frozenset["Ability"]:
        return abilities_for_tier(self.tier)

    @property
    def losing_history(self) -> bool:
        """Memory: have I lost to this opponent more than I've beaten them?"""
        w, l = self.memory_vs_opponent
        return l > w and l >= 2

    @property
    def hp_pct(self) -> float:
        return self.hp / self.max_hp if self.max_hp else 0.0

    def can_afford(self, move: Move) -> bool:
        return self.energy >= MOVE_TABLE[move][0]

    def usable_moves(self, opponent: "FighterState") -> list[Move]:
        moves = [m for m in Move if self.can_afford(m)]
        if opponent.hp_pct >= FINISHER_HP_THRESHOLD and Move.FINISHER in moves:
            moves.remove(Move.FINISHER)
        return moves


class PersonalityPolicy:
    """Rule-tree policies — the doc's `decide_move`, grown up a little."""

    @staticmethod
    def decide(
        me: FighterState, opp: FighterState, rng: random.Random
    ) -> Move:
        usable = me.usable_moves(opp)

        if me.personality == Personality.AGGRESSIVE:
            return PersonalityPolicy._aggressive(me, opp, usable, rng)
        if me.personality == Personality.DEFENSIVE:
            return PersonalityPolicy._defensive(me, opp, usable, rng)
        return PersonalityPolicy._tactical(me, opp, usable, rng)

    # -- Aggressive: end the fight before it ends you --------------------

    @staticmethod
    def _aggressive(me, opp, usable, rng) -> Move:
        if Move.FINISHER in usable:
            return Move.FINISHER
        ps_rate = 0.55 if me.losing_history else 0.7
        if Move.POWER_STRIKE in usable and rng.random() < ps_rate:
            return Move.POWER_STRIKE
        if me.losing_history and me.hp_pct < 0.35 and rng.random() < 0.4:
            return Move.GUARD  # even hotheads learn eventually
        if Move.STRIKE in usable:
            return Move.STRIKE
        # Out of energy — forced to breathe
        return Move.GUARD

    # -- Defensive: survive, punish, outlast -----------------------------

    @staticmethod
    def _defensive(me, opp, usable, rng) -> Move:
        # Opponent looks loaded for a big hit? Brace.
        opp_threat = opp.energy >= 30 and opp.hp_pct > 0.25
        if me.hp_pct < 0.5 and opp_threat and rng.random() < 0.6:
            return Move.GUARD
        if Move.FINISHER in usable and rng.random() < 0.8:
            return Move.FINISHER
        if me.energy < 25:
            return Move.GUARD  # guard restores energy
        if Move.POWER_STRIKE in usable and opp.guarding is False and rng.random() < 0.35:
            return Move.POWER_STRIKE
        if Move.STRIKE in usable:
            return Move.STRIKE
        return Move.GUARD

    # -- Tactical: read, stack, strike at the right moment ----------------

    @staticmethod
    def _tactical(me, opp, usable, rng) -> Move:
        # Build focus early (first few rounds only) — then cash it in
        early = len(me.last_moves) < 3
        if early and me.focus < 2 and me.hp_pct > 0.7 and rng.random() < 0.6:
            return Move.ANALYZE
        if Move.FINISHER in usable:
            return Move.FINISHER
        # Predict opponent using intelligence: only guard through a read
        # when genuinely endangered — guarding costs tempo.
        if (
            me.hp_pct < 0.4
            and opp.energy >= 30
            and PersonalityPolicy._predicts(me, opp, rng)
        ):
            return Move.GUARD
        if Move.POWER_STRIKE in usable and me.focus >= 1:
            return Move.POWER_STRIKE
        if Move.STRIKE in usable:
            return Move.STRIKE
        return Move.GUARD

    @staticmethod
    def _predicts(me: FighterState, opp: FighterState, rng: random.Random) -> bool:
        """Chance to read the opponent scales with the intelligence gap,
        evolution (PREDICTIVE_ATTACK), and memory of past fights."""
        edge = (me.intelligence - opp.intelligence) / 200.0
        base = 0.25 + edge
        if Ability.PREDICTIVE_ATTACK in me.abilities:
            base += 0.15
        w, l = me.memory_vs_opponent
        base += min(0.1, 0.02 * (w + l))  # familiarity breeds insight
        return rng.random() < max(0.05, min(0.75, base))
