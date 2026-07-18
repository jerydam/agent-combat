"""Agent Combat — authoritative real-time engine.

The server owns every rule: wind-ups, cooldowns, block windows, parries,
stamina, abilities. Clients only send taps; they cannot lie about state.
The full timestamped input/event trace is kept for movesHash.

All tunables sit in TUNING — the dial panel for making the fight feel
right.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Literal

from ..engine.agent_engine import FighterState as ChainStats  # on-chain stats

TUNING = {
    "match_duration_ms": 90_000,
    # attack timing (ms), scaled by speed
    "windup_base": 550,
    "windup_per_speed": 2.5,
    "heavy_windup_mult": 1.6,
    "cooldown_base": 500,
    "cooldown_per_speed": 2,
    # defense
    "block_window_ms": 400,
    "block_cooldown_ms": 300,
    "parry_window_ms": 150,
    "block_spam_shrink": 0.25,
    "block_spam_memory_ms": 1500,
    "stagger_ms": 500,
    # damage
    "light_base": 12,
    "heavy_base": 22,
    "crit_base": 0.05,
    "crit_per_int": 0.0015,
    "crit_mult": 1.5,
    "block_reduction": 0.75,
    "block_reduction_per_def": 0.001,
    "heavy_vs_block_reduction": 0.40,
    # stamina
    "stamina_max": 100.0,
    "light_cost": 12.0,
    "heavy_cost": 22.0,
    "defend_cost": 6.0,
    "regen_per_sec": 9.0,
    "second_wind_regen": 14.0,
    "second_wind_at": 30.0,
    "int_cost_discount": 0.001,
    "exhaust_ms": 2000,
    "exhaust_ms_per_int": 8,
    "exhaust_dmg_taken_mult": 1.25,
    "exhaust_block_window_mult": 0.5,
    # scoring
    "defend_score": 8,
    "parry_score": 20,
}

AttackKind = Literal["light", "heavy"]


@dataclass
class Combatant:
    """In-match state, initialized from on-chain stats."""

    stats: ChainStats
    mods: dict = field(default_factory=dict)  # equipped power modifiers
    max_hp: int = 0
    hp: int = 0
    stamina: float = TUNING["stamina_max"]
    exhausted_until: float = -1.0
    staggered_until: float = -1.0

    phase: Literal["idle", "windup", "cooldown"] = "idle"
    phase_ends_at: float = 0.0
    attack_kind: AttackKind = "light"

    block_opened_at: float = -1.0
    block_window_until: float = -1.0
    block_cooldown_until: float = -1.0
    recent_block_presses: list[float] = field(default_factory=list)

    damage_dealt: int = 0
    hits_landed: int = 0
    attacks_thrown: int = 0
    defends: int = 0
    parries: int = 0

    def __post_init__(self) -> None:
        s = self.stats
        self.max_hp = 100 + s.level * 10 + s.defense // 2
        self.hp = self.max_hp

    # -- abilities from evolution tier --
    @property
    def has_counter(self) -> bool:
        return self.stats.tier >= 2

    @property
    def has_predictive(self) -> bool:
        return self.stats.tier >= 2

    @property
    def has_quantum(self) -> bool:
        return self.stats.tier >= 3

    def windup_ms(self, kind: AttackKind) -> float:
        base = TUNING["windup_base"] - self.stats.speed * TUNING["windup_per_speed"]
        return base * TUNING["heavy_windup_mult"] if kind == "heavy" else base

    def cooldown_ms(self) -> float:
        return TUNING["cooldown_base"] - self.stats.speed * TUNING["cooldown_per_speed"]

    def is_exhausted(self, now: float) -> bool:
        return now < self.exhausted_until

    def snapshot(self) -> dict:
        return {
            "hp": self.hp,
            "max_hp": self.max_hp,
            "stamina": round(self.stamina, 1),
            "phase": self.phase,
            "phase_ends_at": round(self.phase_ends_at),
            "attack_kind": self.attack_kind,
            "blocking": self.block_opened_at >= 0,
            "exhausted_until": round(self.exhausted_until),
            "staggered_until": round(self.staggered_until),
            "score": {
                "damage": self.damage_dealt,
                "hits": self.hits_landed,
                "attacks": self.attacks_thrown,
                "defends": self.defends,
                "parries": self.parries,
            },
        }


class CombatMatch:
    """One fight. tick() is the only mutator besides the two inputs."""

    def __init__(
        self,
        a: ChainStats,
        b: ChainStats,
        seed: int | None = None,
        mods_a: dict | None = None,
        mods_b: dict | None = None,
    ):
        self.f: list[Combatant] = [
            Combatant(a, mods_a or {}),
            Combatant(b, mods_b or {}),
        ]
        self.t: float = 0.0
        self.over: bool = False
        self.winner: int | None = None
        self.win_reason: str = ""  # ko | score | hp | tiebreak
        self.rng = random.Random(seed)
        self.events: list[dict] = []  # this tick, for broadcasting
        self.log: list[dict] = []  # full trace -> movesHash

    # ------------------------------------------------------------- inputs

    def input_attack(self, who: int, kind: AttackKind) -> None:
        """Server-validated: taps during windup/cooldown/stagger do nothing."""
        if self.over:
            return
        f, now = self.f[who], self.t
        if f.phase != "idle" or now < f.staggered_until or f.is_exhausted(now):
            return
        cost = TUNING["heavy_cost"] if kind == "heavy" else TUNING["light_cost"]
        if not self._spend(f, cost, now, who):
            return
        f.phase = "windup"
        f.attack_kind = kind
        f.phase_ends_at = now + f.windup_ms(kind)
        f.attacks_thrown += 1
        self._push({"t": round(now), "kind": "windup", "who": who, "attack": kind})

    def input_defend(self, who: int) -> None:
        if self.over:
            return
        f, now = self.f[who], self.t
        if now < f.block_cooldown_until or now < f.staggered_until:
            return
        if not self._spend(f, TUNING["defend_cost"], now, who):
            return
        f.recent_block_presses = [
            t for t in f.recent_block_presses
            if now - t < TUNING["block_spam_memory_ms"]
        ]
        shrink = min(0.75, len(f.recent_block_presses) * TUNING["block_spam_shrink"])
        f.recent_block_presses.append(now)
        win = TUNING["block_window_ms"] * (1 - shrink)
        if f.is_exhausted(now):
            win *= TUNING["exhaust_block_window_mult"]
        f.block_opened_at = now
        f.block_window_until = now + win
        f.block_cooldown_until = now + win + TUNING["block_cooldown_ms"]
        self._push({"t": round(now), "kind": "defend", "who": who})

    # --------------------------------------------------------------- tick

    def tick(self, dt_ms: float) -> None:
        if self.over:
            return
        self.events = []
        self.t += dt_ms
        now = self.t

        for f in self.f:
            regen = (
                TUNING["second_wind_regen"]
                if f.stamina < TUNING["second_wind_at"]
                else TUNING["regen_per_sec"]
            ) * f.mods.get("regen_mult", 1.0)
            if not f.is_exhausted(now):
                f.stamina = min(
                    TUNING["stamina_max"], f.stamina + regen * dt_ms / 1000
                )
            elif f.exhausted_until <= now:
                f.stamina = max(f.stamina, 20.0)
            if f.block_opened_at >= 0 and now > f.block_window_until:
                f.block_opened_at = -1.0

        for idx in (0, 1):
            if self.over:
                break  # a KO this tick ends the fight; no post-death swings
            f = self.f[idx]
            if f.phase == "windup" and now >= f.phase_ends_at:
                if now < f.staggered_until:
                    f.phase = "cooldown"  # parried mid-swing: fizzle
                    f.phase_ends_at = now + f.cooldown_ms()
                else:
                    self._resolve_hit(idx)
            elif f.phase == "cooldown" and now >= f.phase_ends_at:
                f.phase = "idle"

        if not self.over and now >= TUNING["match_duration_ms"]:
            self.over = True
            sa, sb = self.score(0), self.score(1)
            if sa != sb:
                self.winner = 0 if sa > sb else 1
                self.win_reason = "score"
            elif self.f[0].hp != self.f[1].hp:
                self.winner = 0 if self.f[0].hp > self.f[1].hp else 1
                self.win_reason = "hp"
            else:
                self.winner = 0 if self.f[0].stats.speed >= self.f[1].stats.speed else 1
                self.win_reason = "tiebreak"
            self._push({"t": round(now), "kind": "time", "winner": self.winner})

    # ------------------------------------------------------------ internal

    def _spend(self, f: Combatant, raw: float, now: float, who: int) -> bool:
        if f.is_exhausted(now):
            return False
        f.stamina -= raw * (1 - f.stats.intelligence * TUNING["int_cost_discount"])
        if f.stamina <= 0:
            f.stamina = 0
            f.exhausted_until = (
                now + TUNING["exhaust_ms"]
                - f.stats.intelligence * TUNING["exhaust_ms_per_int"]
            )
            self._push({"t": round(now), "kind": "exhausted", "who": who})
        return True

    def _resolve_hit(self, attacker_idx: int) -> None:
        atk = self.f[attacker_idx]
        d_idx = 1 - attacker_idx
        dfd = self.f[d_idx]
        now, kind = self.t, atk.attack_kind

        base = TUNING["heavy_base"] if kind == "heavy" else TUNING["light_base"]
        dmg = base * (1 + atk.stats.attack / 200)
        dmg *= 1 - dfd.stats.defense / (dfd.stats.defense + 150)
        crit = self.rng.random() < (
            TUNING["crit_base"] + atk.stats.intelligence * TUNING["crit_per_int"]
        )
        if crit:
            dmg *= TUNING["crit_mult"]
        if dfd.is_exhausted(now):
            dmg *= TUNING["exhaust_dmg_taken_mult"]

        block_open = now <= dfd.block_window_until and dfd.block_opened_at >= 0
        opened_ago = now - dfd.block_opened_at
        parry_window = TUNING["parry_window_ms"] + dfd.mods.get("parry_bonus_ms", 0)
        is_parry = block_open and opened_ago <= parry_window
        if block_open and not is_parry and dfd.has_quantum and self.rng.random() < 0.10:
            is_parry = True

        if is_parry:
            atk.staggered_until = now + TUNING["stagger_ms"]
            dfd.parries += 1
            dfd.defends += 1
            counter = 0
            if dfd.has_counter:
                counter = max(1, round(dmg * 0.3))
                atk.hp = max(0, atk.hp - counter)
                dfd.damage_dealt += counter
            self._push({
                "t": round(now), "kind": "parry", "who": d_idx,
                "counter": counter, "attacker_hp": atk.hp,
            })
        elif block_open:
            reduction = (
                TUNING["heavy_vs_block_reduction"]
                if kind == "heavy"
                else min(
                    0.9,
                    TUNING["block_reduction"]
                    + dfd.stats.defense * TUNING["block_reduction_per_def"]
                    + dfd.mods.get("block_bonus", 0.0),
                )
            )
            taken = max(1, round(dmg * (1 - reduction)))
            dfd.hp = max(0, dfd.hp - taken)
            atk.damage_dealt += taken
            dfd.defends += 1
            self._push({
                "t": round(now), "kind": "blocked", "who": d_idx,
                "dmg": taken, "target_hp": dfd.hp,
            })
        else:
            taken = max(1, round(dmg))
            dfd.hp = max(0, dfd.hp - taken)
            atk.damage_dealt += taken
            atk.hits_landed += 1
            self._push({
                "t": round(now), "kind": "hit", "who": attacker_idx,
                "attack": kind, "dmg": taken, "crit": crit, "target_hp": dfd.hp,
            })

        atk.phase = "cooldown"
        atk.phase_ends_at = now + atk.cooldown_ms()

        for idx in (0, 1):
            if self.f[idx].hp <= 0 and not self.over:
                self.over = True
                self.winner = 1 - idx
                self.win_reason = "ko"
                self._push({"t": round(now), "kind": "ko", "who": idx})

    def _push(self, e: dict) -> None:
        self.events.append(e)
        self.log.append(e)

    # -------------------------------------------------------------- views

    def score(self, who: int) -> int:
        f = self.f[who]
        return round(
            f.damage_dealt
            + f.defends * TUNING["defend_score"]
            + f.parries * TUNING["parry_score"]
        )

    def snapshot(self) -> dict:
        return {
            "t": round(self.t),
            "over": self.over,
            "winner": self.winner,
            "fighters": [f.snapshot() for f in self.f],
            "events": self.events,
        }

    def result_log(self) -> dict:
        """Full auditable trace — hash this into movesHash."""
        return {
            "mode": "realtime",
            "duration_ms": round(self.t),
            "winner": self.winner,
            "win_reason": self.win_reason,
            "fighters": [
                {
                    "token_id": f.stats.token_id,
                    "name": f.stats.name,
                    "final_hp": f.hp,
                    "max_hp": f.max_hp,
                    "score": self.score(i),
                    "hits": f.hits_landed,
                    "defends": f.defends,
                    "parries": f.parries,
                }
                for i, f in enumerate(self.f)
            ],
            "trace": self.log,
        }
