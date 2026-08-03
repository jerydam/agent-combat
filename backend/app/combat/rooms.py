"""Combat rooms: WebSocket sessions around the authoritative engine.

Tick rate 20Hz (50ms). Clients send taps; the server ticks, runs any bot
controllers, and broadcasts snapshots. Input messages are validated by
the engine itself (cooldowns, stamina, stagger are server state), so a
modified client gains nothing.

Modes:
- practice: player vs bot, nothing recorded, works with zero chain setup.
- (live PvP rooms reuse this class with two human slots — wired when
  battle events land; see routers/combat.py)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from ..engine.agent_engine import FighterState as ChainStats
from .bot_ai import BotController
from .engine import CombatMatch

log = logging.getLogger("arena.combat")

TICK_MS = 50
COUNTDOWN_MS = 3000


def _flip_who(e: dict) -> dict:
    """Mirror a single event's actor index."""
    who = e.get("who")
    return {**e, "who": 1 - who} if isinstance(who, int) else e


def orient(payload: dict, slot: int) -> dict:
    """Rewrite a broadcast so index 0 is always the RECEIVING player.

    Both fighters are slot 0 from their own point of view. Rather than
    teach the client to index by slot everywhere — HUD, damage numbers,
    particles, knockback, win text, all of which assume "0 is me" — the
    server mirrors the payload once per recipient. Player 1 then runs the
    exact same UI code as player 0 with no special cases.

    This is a VIEW ONLY. The canonical log that gets hashed into
    movesHash is `match.result_log()` taken directly from the engine, and
    is never passed through here, so mirroring can't affect what is
    committed on-chain.
    """
    out = dict(payload)

    # Per-recipient fields (rewards differ per player, and broadcasting
    # both would leak the opponent's payout into your result screen).
    by_slot = out.pop("by_slot", None)
    if isinstance(by_slot, dict):
        out.update(by_slot.get(str(slot)) or by_slot.get(slot) or {})

    if slot == 0:
        return out

    fighters = out.get("fighters")
    if isinstance(fighters, list) and len(fighters) == 2:
        out["fighters"] = [fighters[1], fighters[0]]
    if isinstance(out.get("events"), list):
        out["events"] = [_flip_who(e) for e in out["events"]]
    if out.get("winner") in (0, 1):
        out["winner"] = 1 - out["winner"]

    log = out.get("log")
    if isinstance(log, dict):
        log = dict(log)
        lf = log.get("fighters")
        if isinstance(lf, list) and len(lf) == 2:
            log["fighters"] = [lf[1], lf[0]]
        if log.get("winner") in (0, 1):
            log["winner"] = 1 - log["winner"]
        if isinstance(log.get("trace"), list):
            log["trace"] = [_flip_who(e) for e in log["trace"]]
        out["log"] = log
    return out


@dataclass
class Room:
    room_id: str
    match: CombatMatch
    humans: dict[int, WebSocket] = field(default_factory=dict)  # slot -> ws
    bots: list[BotController] = field(default_factory=list)
    started: bool = False
    task: asyncio.Task | None = None
    on_finish: object | None = None  # async callback(room) -> dict | None
    wallet: str = ""       # player wallet (slot 0), for rewards
    agent_id: int | None = None  # minted agent fighting in slot 0, if any
    solo_game_id: int | None = None  # on-chain staked SoloArena game
    # --- PvP: per-slot identity, since both slots are real players ---
    mode: str = "solo"                                  # solo | pvp
    coach: object | None = None    # training only: freezes the fight to teach
    wallets: dict[int, str] = field(default_factory=dict)
    agent_ids: dict[int, int | None] = field(default_factory=dict)
    skins: dict[int, str] = field(default_factory=dict)   # avatar item ids


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create(
        self,
        room_id: str,
        a: ChainStats,
        b: ChainStats,
        bot_slots: list[int],
        seed: int | None = None,
        on_finish=None,
        mods_a: dict | None = None,
        mods_b: dict | None = None,
    ) -> Room:
        match = CombatMatch(a, b, seed=seed, mods_a=mods_a, mods_b=mods_b)
        room = Room(room_id=room_id, match=match, on_finish=on_finish)
        for slot in bot_slots:
            room.bots.append(BotController(match, slot, seed=seed))
        self.rooms[room_id] = room
        return room

    def get(self, room_id: str) -> Room | None:
        return self.rooms.get(room_id)

    async def join(self, room: Room, slot: int, ws: WebSocket) -> None:
        room.humans[slot] = ws
        needed = {0, 1} - {b.who for b in room.bots}
        if needed.issubset(room.humans.keys()) and not room.started:
            room.started = True
            room.task = asyncio.create_task(self._run(room))

    async def handle_input(self, room: Room, slot: int, msg: dict) -> None:
        """One action per message; the engine rejects anything illegal."""
        if not room.started or not room.match or room.match.over:
            return
        kind = msg.get("type")
        if kind == "attack":
            heavy = msg.get("heavy") is True
            room.match.input_attack(slot, "heavy" if heavy else "light")
        elif kind == "defend":
            room.match.input_defend(slot)
        elif kind == "super":
            # engine checks the meter is actually full — a hacked client
            # asking for a free super just gets ignored
            room.match.input_super(slot)

    async def leave(self, room: Room, slot: int) -> None:
        """Disconnect: the fighter's own AI takes over so matches finish."""
        room.humans.pop(slot, None)
        if room.started and not room.match.over:
            if all(b.who != slot for b in room.bots):
                room.bots.append(BotController(room.match, slot))
                log.info("Room %s: slot %s AI takeover", room.room_id, slot)
                # Tell whoever is left why their opponent suddenly plays
                # like a bot — silently swapping a human for an AI
                # mid-fight would just look like the game cheating.
                if room.mode == "pvp":
                    for other, ws in list(room.humans.items()):
                        try:
                            await ws.send_json({
                                "kind": "opponent_left",
                                "message": "Opponent disconnected — their agent is "
                                           "being played by AI for the rest of the round.",
                            })
                        except Exception:
                            pass
        if not room.humans and (room.match.over or not room.started):
            self._cleanup(room)

    # ---------------------------------------------------------- game loop

    async def _run(self, room: Room) -> None:
        m = room.match
        try:
            # countdown
            for remaining in (3, 2, 1):
                await self._broadcast(room, {"kind": "countdown", "n": remaining})
                await asyncio.sleep(COUNTDOWN_MS / 3000)
            await self._broadcast(room, {"kind": "fight"})

            last = time.monotonic()
            while not m.over:
                await asyncio.sleep(TICK_MS / 1000)
                now = time.monotonic()
                dt = (now - last) * 1000
                last = now

                if room.coach is not None:
                    room.coach.before_tick(m)

                if m.paused:
                    # Frozen for a coaching prompt: no time passes, no bot
                    # decisions, no new events — but the player's taps still
                    # reach the engine, stamped at the frozen timestamp.
                    m.events = []
                else:
                    m.tick(dt)
                    for bot in room.bots:
                        bot.update()

                extra: dict = {}
                if room.coach is not None:
                    room.coach.after_tick(m)
                    extra = room.coach.paused_payload(m)
                    if (note := room.coach.message(m)) is not None:
                        await self._broadcast(room, note)

                await self._broadcast(room, {"kind": "state", **m.snapshot(), **extra})

            extra: dict = {}
            if room.on_finish is not None:
                try:
                    extra = await room.on_finish(room) or {}  # type: ignore[operator]
                except Exception:
                    log.exception("Room %s on_finish failed", room.room_id)
            await self._broadcast(
                room,
                {
                    "kind": "result",
                    "winner": m.winner,
                    "win_reason": m.win_reason,
                    "log": m.result_log(),
                    **extra,
                },
            )
        except Exception:
            log.exception("Room %s crashed", room.room_id)
        finally:
            self._cleanup(room)

    async def _broadcast(self, room: Room, payload: dict) -> None:
        dead = []
        # list() because leave() can mutate humans while we iterate
        for slot, ws in list(room.humans.items()):
            try:
                await ws.send_json(orient(payload, slot))
            except Exception:
                dead.append(slot)
        for slot in dead:
            await self.leave(room, slot)

    def _cleanup(self, room: Room) -> None:
        self.rooms.pop(room.room_id, None)


manager = RoomManager()
