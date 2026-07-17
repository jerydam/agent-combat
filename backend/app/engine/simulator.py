"""Deterministic battle simulator.

simulate(agent_a, agent_b, seed) is a pure function: same inputs always
produce the same battle log and winner. The seed comes from the on-chain
BattleCreated event, so the backend can't cherry-pick outcomes, and anyone
holding the log can recompute movesHash and verify it against the chain.
"""

from __future__ import annotations

import random

from .agent_engine import (
    MOVE_TABLE,
    Ability,
    FighterState,
    Move,
    PersonalityPolicy,
)

MAX_ROUNDS = 25
ENERGY_REGEN = 10
GUARD_ENERGY_BONUS = 20
FOCUS_DMG_BONUS = 0.15
FOCUS_ACC_BONUS = 0.08


def _damage(
    attacker: FighterState,
    defender: FighterState,
    move: Move,
    rng: random.Random,
) -> tuple[int, bool, bool]:
    """Returns (damage, hit, crit)."""
    _, base, accuracy = MOVE_TABLE[move]
    if base == 0:
        return 0, True, False

    accuracy += attacker.focus * FOCUS_ACC_BONUS
    if rng.random() > accuracy:
        return 0, False, False

    # Attack scales damage up; defense mitigates with diminishing returns.
    dmg = base * (1 + attacker.attack / 200)
    dmg *= 1 - defender.defense / (defender.defense + 150)
    dmg *= 1 + attacker.focus * FOCUS_DMG_BONUS

    # Crit chance driven by intelligence.
    crit = rng.random() < (0.05 + attacker.intelligence * 0.0015)
    if crit:
        dmg *= 1.5

    if defender.guarding:
        # Elite quantum defense: chance to negate the hit entirely
        if (
            Ability.QUANTUM_DEFENSE in defender.abilities
            and rng.random() < 0.10
        ):
            return 0, False, False
        dmg *= 0.5

    # Small deterministic variance so identical stats still vary per seed.
    dmg *= rng.uniform(0.9, 1.1)
    return max(1, round(dmg)), True, crit


def simulate(a: FighterState, b: FighterState, seed: int) -> dict:
    """Run a full battle. Returns the complete, hashable battle log."""
    import copy

    inputs_a, inputs_b = copy.deepcopy(a), copy.deepcopy(b)
    rng = random.Random(seed)
    rounds: list[dict] = []

    for round_no in range(1, MAX_ROUNDS + 1):
        a.guarding = b.guarding = False

        move_a = PersonalityPolicy.decide(a, b, rng)
        move_b = PersonalityPolicy.decide(b, a, rng)

        # Pay energy, apply stance moves first (simultaneous)
        for f, mv in ((a, move_a), (b, move_b)):
            f.energy -= MOVE_TABLE[mv][0]
            f.last_moves.append(mv)
            if mv == Move.GUARD:
                f.guarding = True
                f.energy = min(100, f.energy + GUARD_ENERGY_BONUS)
            elif mv == Move.ANALYZE:
                f.focus = min(3, f.focus + 1)

        # Strike order: speed with deterministic jitter
        order = sorted(
            ((a, move_a, b), (b, move_b, a)),
            key=lambda t: t[0].speed + rng.uniform(0, 10),
            reverse=True,
        )

        events = []
        for attacker, mv, defender in order:
            if attacker.hp <= 0:
                continue  # KO'd before acting this round
            if mv in (Move.GUARD, Move.ANALYZE):
                events.append(
                    {"agent": attacker.token_id, "move": mv.value}
                )
                continue
            dmg, hit, crit = _damage(attacker, defender, mv, rng)
            if hit and mv in (Move.STRIKE, Move.POWER_STRIKE):
                attacker.focus = max(0, attacker.focus - 1)  # focus fades per hit
            defender.hp = max(0, defender.hp - dmg)
            event = {
                "agent": attacker.token_id,
                "move": mv.value,
                "damage": dmg,
                "hit": hit,
                "crit": crit,
                "target_hp": defender.hp,
            }
            # Advanced counter attack: reflect 30% of damage taken while
            # guarding back at the attacker.
            if (
                hit
                and dmg > 0
                and defender.guarding
                and Ability.COUNTER_ATTACK in defender.abilities
            ):
                counter = max(1, round(dmg * 0.3))
                attacker.hp = max(0, attacker.hp - counter)
                event["countered"] = counter
                event["attacker_hp"] = attacker.hp
            events.append(event)

        # Regen
        for f in (a, b):
            f.energy = min(100, f.energy + ENERGY_REGEN)

        rounds.append({"round": round_no, "events": events})

        if a.hp <= 0 or b.hp <= 0:
            break

    # Winner: KO, else higher HP%, else speed, else agent A (deterministic)
    if a.hp <= 0 and b.hp > 0:
        winner = b
    elif b.hp <= 0 and a.hp > 0:
        winner = a
    elif a.hp_pct != b.hp_pct:
        winner = a if a.hp_pct > b.hp_pct else b
    elif a.speed != b.speed:
        winner = a if a.speed > b.speed else b
    else:
        winner = a

    def _inputs(f: FighterState) -> dict:
        return {
            "token_id": f.token_id,
            "personality": f.personality.value,
            "attack": f.attack,
            "defense": f.defense,
            "speed": f.speed,
            "intelligence": f.intelligence,
            "level": f.level,
            "tier": f.tier,
            "memory_vs_opponent": list(f.memory_vs_opponent),
        }

    return {
        "seed": str(seed),
        # Full inputs so anyone can replay: simulate(inputs, seed) == log
        "inputs": {"agent_a": _inputs(inputs_a), "agent_b": _inputs(inputs_b)},
        "agent_a": {
            "token_id": a.token_id,
            "name": a.name,
            "final_hp": a.hp,
            "max_hp": a.max_hp,
        },
        "agent_b": {
            "token_id": b.token_id,
            "name": b.name,
            "final_hp": b.hp,
            "max_hp": b.max_hp,
        },
        "winner": winner.token_id,
        "total_rounds": len(rounds),
        "rounds": rounds,
    }
