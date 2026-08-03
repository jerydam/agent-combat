"""Server-driven training coach.

The tutorial is a REAL fight, so the only way to give a player time to
read "tap DEF now" is to stop the clock — and the clock lives on the
server. This coach freezes the match at the exact teachable moment,
tells the client what to say and which button to light up, and unfreezes
once the player actually does it.

Why the pause offset is the whole design:

    a parry requires the guard to open within PARRY_WINDOW_MS (150ms) of
    impact. Match time does not advance while paused, so whatever the
    player presses during the freeze is stamped at the frozen timestamp.
    Freeze 110ms before impact and a DEF press is guaranteed to parry;
    freeze 320ms before impact and the same press is guaranteed to be an
    ordinary block. One number teaches two different mechanics, and both
    are the real engine rules rather than a scripted animation.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from .engine import TUNING, CombatMatch

#: real seconds to hold a pause before giving up and letting the fight run
PAUSE_TIMEOUT_S = 12.0


@dataclass(frozen=True)
class Step:
    id: str
    title: str
    text: str
    highlight: str | None          # atk | atk-hold | def | super
    #: freeze this many ms before the opponent's blow lands (None = no freeze)
    freeze_before_impact_ms: float | None = None
    #: freeze as soon as the player's super meter is full
    freeze_on_super_ready: bool = False
    #: shown while the step's precondition isn't met yet (e.g. meter still
    #: charging). Without this the super step just says "press SUPER" at a
    #: player who has no super and no idea how to get one.
    alt_text: str | None = None
    alt_highlight: str | None = None


STEPS: list[Step] = [
    Step(
        id="light",
        title="Light attack",
        text="Tap ATK to throw a quick jab. It is fast and cheap — this is your "
             "main damage.",
        highlight="atk",
    ),
    Step(
        id="heavy",
        title="Heavy attack",
        text="Now HOLD ATK for about half a second and let go. Twice the damage, "
             "but a long wind-up your opponent can see coming.",
        highlight="atk-hold",
    ),
    Step(
        id="block",
        title="Block",
        text="Your opponent is swinging at you. Tap DEF to raise your guard and "
             "soak most of the hit.",
        highlight="def",
        # Comfortably inside the 400ms guard window so the block always
        # connects after the freeze lifts, but well outside the 150ms
        # parry window so this step can only ever teach a plain block.
        freeze_before_impact_ms=250.0,
    ),
    Step(
        id="parry",
        title="Parry",
        text="Their strike is about to land — this is the exact moment. Tap DEF "
             "RIGHT NOW to parry: no damage at all, and they get staggered.",
        highlight="def",
        freeze_before_impact_ms=110.0,
    ),
    Step(
        id="super",
        title="Super",
        text="Your special is fully charged. Press SUPER to unleash it — far more "
             "damage than a heavy, but slow enough that a sharp opponent can block it.",
        highlight="super",
        freeze_on_super_ready=True,
        alt_text="Keep attacking to charge the orange SUPER bar under your stamina. "
                 "Landing hits fills it fastest — taking them fills it too.",
        alt_highlight="atk",
    ),
]

STEP_BY_ID = {s.id: s for s in STEPS}


class Coach:
    """Drives the tutorial for slot 0. One instance per training room."""

    def __init__(self) -> None:
        self.index = 0
        self.done = False
        self._log_seen = 0
        self._paused_at: float | None = None   # real (monotonic) time
        self._dirty = True                     # send a coach message next tick
        #: the opponent swing we already froze for, so a player who answers
        #: the prompt isn't immediately re-frozen for the SAME attack —
        #: which deadlocks the match, since time can't advance to the impact
        self._frozen_for: float | None = None
        self._alt = False   # showing the 'precondition not met yet' prompt

    # ------------------------------------------------------------- helpers

    @property
    def step(self) -> Step | None:
        return STEPS[self.index] if self.index < len(STEPS) else None

    def _advance(self) -> None:
        self.index += 1
        if self.index >= len(STEPS):
            self.done = True
        self._frozen_for = None
        self._dirty = True

    def _freeze(self, m: CombatMatch, for_swing: float | None) -> None:
        m.paused = True
        self._paused_at = time.monotonic()
        self._frozen_for = for_swing
        self._dirty = True

    def _thaw(self, m: CombatMatch) -> None:
        m.paused = False
        self._paused_at = None

    def _new_events(self, m: CombatMatch) -> list[dict]:
        events = m.log[self._log_seen:]
        self._log_seen = len(m.log)
        return events

    # ---------------------------------------------------------------- tick

    def before_tick(self, m: CombatMatch) -> None:
        """Decide whether the match should be frozen this tick."""
        if self.done or m.over:
            m.paused = False
            return

        step = self.step
        if step is None:
            m.paused = False
            return

        # already frozen: hold until the player acts or we time out
        if m.paused:
            if self._paused_at and time.monotonic() - self._paused_at > PAUSE_TIMEOUT_S:
                self._thaw(m)
                self._dirty = True
            return

        me, opp = m.f[0], m.f[1]

        # Freeze just before the incoming blow lands (block / parry steps).
        if step.freeze_before_impact_ms is not None:
            if opp.phase == "windup" and opp.phase_ends_at != self._frozen_for:
                remaining = opp.phase_ends_at - m.t
                if 0 < remaining <= step.freeze_before_impact_ms:
                    # Don't freeze if the player is mid-stagger or gassed —
                    # they physically could not answer the prompt.
                    if m.t >= me.staggered_until and not me.is_exhausted(m.t):
                        self._freeze(m, for_swing=opp.phase_ends_at)
                        # Teaching accommodation: hand them a CLEAN guard.
                        # Repeated DEF presses normally shrink the block
                        # window (25% each) and leave a cooldown, so a
                        # nervous learner tapping during the freeze would
                        # shrink their window below the very timing we just
                        # told them was correct — and the lesson would fail
                        # for reasons it never explained.
                        me.recent_block_presses.clear()
                        me.block_cooldown_until = -1.0

        # Freeze the moment the special is available.
        elif step.freeze_on_super_ready:
            if me.super_ready and me.phase == "idle" and m.t >= me.staggered_until:
                self._freeze(m, for_swing=None)

    def after_tick(self, m: CombatMatch) -> None:
        """Consume this tick's events and advance the lesson if satisfied."""
        if self.done:
            return
        step = self.step
        if step is None:
            return

        for e in self._new_events(m):
            if e.get("who") != 0:
                continue
            kind = e.get("kind")
            hit = (
                (step.id == "light" and kind == "windup" and e.get("attack") == "light")
                or (step.id == "heavy" and kind == "windup" and e.get("attack") == "heavy")
                or (step.id == "block" and kind == "blocked")
                or (step.id == "parry" and kind == "parry")
                or (step.id == "super" and kind == "super_start")
            )
            if hit:
                self._thaw(m)
                self._advance()
                break

        # The player raised their guard: unfreeze so the swing can actually
        # land on it. The step completes (or doesn't) from the real outcome
        # a moment later — and `_frozen_for` stops us re-freezing this same
        # swing, which would stall time before the impact ever resolved.
        if m.paused and step.freeze_before_impact_ms is not None:
            if m.f[0].block_opened_at >= 0:
                self._thaw(m)

    # ------------------------------------------------------------- payload

    def _use_alt(self, m: CombatMatch) -> bool:
        """True while the step's precondition isn't satisfied yet."""
        step = self.step
        if step is None or step.alt_text is None:
            return False
        if step.freeze_on_super_ready:
            return not m.f[0].super_ready
        return False

    def message(self, m: CombatMatch) -> dict | None:
        """A `coach` payload when something changed, else None."""
        alt = self._use_alt(m)
        if alt != self._alt:
            self._alt = alt
            self._dirty = True
        if not self._dirty:
            return None
        self._dirty = False
        step = self.step
        if step is None:
            return {"kind": "coach", "index": self.index, "total": len(STEPS),
                    "done": self.done, "id": None, "title": None,
                    "text": None, "highlight": None}
        return {
            "kind": "coach",
            "index": self.index,
            "total": len(STEPS),
            "done": self.done,
            "id": step.id,
            "title": step.title,
            "text": (step.alt_text if alt else step.text),
            "highlight": (step.alt_highlight if alt else step.highlight),
        }

    def paused_payload(self, m: CombatMatch) -> dict:
        """Extra fields merged into every state broadcast."""
        return {
            "paused": bool(getattr(m, "paused", False)),
            "coach_index": self.index,
            "coach_done": self.done,
        }
