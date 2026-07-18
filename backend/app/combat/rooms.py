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

    async def leave(self, room: Room, slot: int) -> None:
        """Disconnect: the fighter's own AI takes over so matches finish."""
        room.humans.pop(slot, None)
        if room.started and not room.match.over:
            if all(b.who != slot for b in room.bots):
                room.bots.append(BotController(room.match, slot))
                log.info("Room %s: slot %s AI takeover", room.room_id, slot)
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
                m.tick(dt)
                for bot in room.bots:
                    bot.update()
                await self._broadcast(room, {"kind": "state", **m.snapshot()})

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
        for slot, ws in room.humans.items():
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(slot)
        for slot in dead:
            await self.leave(room, slot)

    def _cleanup(self, room: Room) -> None:
        self.rooms.pop(room.room_id, None)


manager = RoomManager()
