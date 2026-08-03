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
    "super_score": 35,
    # ---- SUPER (the Mortal-Kombat-style meter move) -------------------
    # The meter is earned, not given: mostly by landing hits, partly by
    # eating them, so a losing player still builds a comeback option.
    "super_max": 100.0,
    "super_gain_per_dmg_dealt": 1.25,
    "super_gain_per_dmg_taken": 0.55,
    "super_gain_on_parry": 12.0,
    "super_gain_on_block": 3.0,
    # Long, obvious wind-up. A super MUST be reactable — an unblockable
    # instant nuke would just be a coin flip on who charged first.
    "super_windup_ms": 900,
    "super_cooldown_ms": 900,
    "super_base": 46,
    "super_crit_mult": 1.35,
    # Blocking a super still hurts a lot (it beats a normal block), but
    # it is the difference between surviving and not.
    "super_block_reduction": 0.55,
    # Parrying one is the highest-skill play in the game and fully
    # negates it, with a long punish window.
    "super_parry_stagger_ms": 1100,
    "super_parry_counter_mult": 0.45,
    "super_stamina_cost": 15.0,
}

AttackKind = Literal["light", "heavy", "super"]


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

    # --- super meter ---
    super_meter: float = 0.0
    supers_landed: int = 0

    def __post_init__(self) -> None:
        s = self.stats
        # `hp_bonus` is the avatar's contribution — a heavier suit of
        # armour is literally more health to chew through.
        self.max_hp = (
            100 + s.level * 10 + s.defense // 2 + int(self.mods.get("hp_bonus", 0))
        )
        self.hp = self.max_hp

    # -- avatar-driven modifiers (default to "no effect") --
    @property
    def power_mult(self) -> float:
        """Hit power: multiplies damage this fighter deals."""
        return float(self.mods.get("power_mult", 1.0))

    @property
    def damage_taken_mult(self) -> float:
        """Defence rate: multiplies damage this fighter receives."""
        return float(self.mods.get("damage_taken_mult", 1.0))

    @property
    def windup_mult(self) -> float:
        """Attack speed: <1 winds up faster, >1 slower."""
        return float(self.mods.get("windup_mult", 1.0))

    @property
    def crit_bonus(self) -> float:
        return float(self.mods.get("crit_bonus", 0.0))

    @property
    def super_gain_mult(self) -> float:
        return float(self.mods.get("super_gain_mult", 1.0))

    @property
    def super_ready(self) -> bool:
        return self.super_meter >= TUNING["super_max"]

    def add_super(self, amount: float) -> None:
        self.super_meter = min(TUNING["super_max"], self.super_meter + amount)

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
        if kind == "super":
            # deliberately NOT scaled by avatar speed — every super gets
            # the same reactable telegraph, or fast avatars would own an
            # unanswerable move
            return TUNING["super_windup_ms"]
        base = TUNING["windup_base"] - self.stats.speed * TUNING["windup_per_speed"]
        if kind == "heavy":
            base *= TUNING["heavy_windup_mult"]
        return max(90.0, base * self.windup_mult)

    def cooldown_ms(self) -> float:
        base = TUNING["cooldown_base"] - self.stats.speed * TUNING["cooldown_per_speed"]
        return max(80.0, base * self.windup_mult)

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
            "super_meter": round(self.super_meter, 1),
            "super_ready": self.super_ready,
            "score": {
                "damage": self.damage_dealt,
                "hits": self.hits_landed,
                "attacks": self.attacks_thrown,
                "defends": self.defends,
                "parries": self.parries,
                "supers": self.supers_landed,
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
        # Training only: when True the room loop stops advancing time, so
        # the coach can freeze a teachable moment. Inputs still register —
        # they're stamped at the frozen timestamp, which is exactly how a
        # guided parry is made reliable (see combat/coach.py).
        self.paused: bool = False

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

    def input_super(self, who: int) -> bool:
        """Spend a full meter on the special. Returns True if it launched.

        Server-authoritative like every other input: a client that asks
        for a super without a full bar simply gets ignored.
        """
        if self.over:
            return False
        f, now = self.f[who], self.t
        if not f.super_ready:
            return False
        if f.phase != "idle" or now < f.staggered_until or f.is_exhausted(now):
            return False
        # A super costs stamina too, so it can't be fired while gassed out
        if not self._spend(f, TUNING["super_stamina_cost"], now, who):
            return False

        f.super_meter = 0.0
        f.phase = "windup"
        f.attack_kind = "super"
        f.phase_ends_at = now + f.windup_ms("super")
        f.attacks_thrown += 1
        self._push({
            "t": round(now), "kind": "super_start", "who": who,
            "windup_ms": round(f.windup_ms("super")),
        })
        return True

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
        is_super = kind == "super"

        base = (
            TUNING["super_base"] if is_super
            else TUNING["heavy_base"] if kind == "heavy"
            else TUNING["light_base"]
        )
        dmg = base * (1 + atk.stats.attack / 200)
        dmg *= 1 - dfd.stats.defense / (dfd.stats.defense + 150)
        # --- avatar modifiers: the attacker's hit power vs the
        # defender's defence rate. Both default to 1.0, so an agent with
        # no skin equipped fights exactly as it always did.
        dmg *= atk.power_mult
        dmg *= dfd.damage_taken_mult
        crit = self.rng.random() < (
            TUNING["crit_base"]
            + atk.stats.intelligence * TUNING["crit_per_int"]
            + atk.crit_bonus
        )
        if crit:
            dmg *= TUNING["super_crit_mult"] if is_super else TUNING["crit_mult"]
        if dfd.is_exhausted(now):
            dmg *= TUNING["exhaust_dmg_taken_mult"]

        block_open = now <= dfd.block_window_until and dfd.block_opened_at >= 0
        opened_ago = now - dfd.block_opened_at
        parry_window = TUNING["parry_window_ms"] + dfd.mods.get("parry_bonus_ms", 0)
        is_parry = block_open and opened_ago <= parry_window
        if block_open and not is_parry and dfd.has_quantum and self.rng.random() < 0.10:
            is_parry = True

        if is_parry:
            # Parrying a super is the single biggest swing in the game:
            # the whole move is negated and the punish window is long.
            atk.staggered_until = now + (
                TUNING["super_parry_stagger_ms"] if is_super else TUNING["stagger_ms"]
            )
            dfd.parries += 1
            dfd.defends += 1
            dfd.add_super(TUNING["super_gain_on_parry"] * dfd.super_gain_mult)
            counter = 0
            if dfd.has_counter or is_super:
                mult = TUNING["super_parry_counter_mult"] if is_super else 0.3
                counter = max(1, round(dmg * mult))
                atk.hp = max(0, atk.hp - counter)
                dfd.damage_dealt += counter
            self._push({
                "t": round(now), "kind": "super_parried" if is_super else "parry",
                "who": d_idx, "counter": counter, "attacker_hp": atk.hp,
            })
        elif block_open:
            if is_super:
                # A super punches through a guard harder than a heavy —
                # blocking survives it, it doesn't shrug it off.
                reduction = min(
                    0.75,
                    TUNING["super_block_reduction"]
                    + dfd.mods.get("block_bonus", 0.0),
                )
            elif kind == "heavy":
                reduction = TUNING["heavy_vs_block_reduction"]
            else:
                reduction = min(
                    0.9,
                    TUNING["block_reduction"]
                    + dfd.stats.defense * TUNING["block_reduction_per_def"]
                    + dfd.mods.get("block_bonus", 0.0),
                )
            taken = max(1, round(dmg * (1 - reduction)))
            dfd.hp = max(0, dfd.hp - taken)
            atk.damage_dealt += taken
            dfd.defends += 1
            atk.add_super(taken * TUNING["super_gain_per_dmg_dealt"] * atk.super_gain_mult)
            dfd.add_super(
                (taken * TUNING["super_gain_per_dmg_taken"]
                 + TUNING["super_gain_on_block"]) * dfd.super_gain_mult
            )
            self._push({
                "t": round(now), "kind": "super_blocked" if is_super else "blocked",
                "who": d_idx, "dmg": taken, "target_hp": dfd.hp,
            })
        else:
            taken = max(1, round(dmg))
            dfd.hp = max(0, dfd.hp - taken)
            atk.damage_dealt += taken
            atk.hits_landed += 1
            if is_super:
                atk.supers_landed += 1
            # Landing hits is the main way the meter fills; eating them
            # fills it slower, so a player being beaten down still earns
            # a comeback button instead of just losing faster.
            atk.add_super(taken * TUNING["super_gain_per_dmg_dealt"] * atk.super_gain_mult)
            dfd.add_super(taken * TUNING["super_gain_per_dmg_taken"] * dfd.super_gain_mult)
            self._push({
                "t": round(now), "kind": "super_hit" if is_super else "hit",
                "who": attacker_idx, "attack": kind, "dmg": taken,
                "crit": crit, "target_hp": dfd.hp,
            })

        atk.phase = "cooldown"
        atk.phase_ends_at = now + (
            TUNING["super_cooldown_ms"] if is_super else atk.cooldown_ms()
        )

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
            + f.supers_landed * TUNING["super_score"]
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
                    "supers": f.supers_landed,
                    # the avatar's contribution is part of the auditable
                    # record — a replay must explain why numbers differed
                    "mods": f.mods or {},
                }
                for i, f in enumerate(self.f)
            ],
            "trace": self.log,
        }
