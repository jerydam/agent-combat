"""Live PvP matchmaking.

Pairs two connected players into one authoritative Room. Two ways in:

- random queue: first-come first-served against anyone else waiting
- private code: both players pass the same ?room=CODE and get each other

The tricky part is that a queued player is holding an open WebSocket
while doing nothing. We can't just `await` the pairing, because a client
that closes its tab while queued would sit in the queue forever and the
next player would be matched against a corpse. So the wait races the
pairing future against a read on the socket: a disconnect makes the read
raise, and we drop out of the queue.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket

from ..engine.agent_engine import FighterState as ChainStats
from .rooms import Room, manager

log = logging.getLogger("arena.matchmaker")

#: how long a player waits before we give up and offer them a bot
MATCH_TIMEOUT_S = 90.0


@dataclass
class Seat:
    """One player waiting to be matched."""

    ws: WebSocket
    wallet: str
    agent_id: int | None
    stats: ChainStats
    mods: dict
    skin: str
    name: str
    #: resolved with (room, slot) once paired
    future: asyncio.Future = field(default_factory=asyncio.Future)

    def describe(self) -> dict:
        return {"name": self.name, "skin": self.skin, "agent_id": self.agent_id}


class Matchmaker:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._queue: list[Seat] = []
        self._private: dict[str, Seat] = {}

    # ------------------------------------------------------------ pairing

    def _pair(self, a: Seat, b: Seat, room_id: str) -> Room:
        """Build the room. `a` takes slot 0, `b` slot 1."""
        room = manager.create(
            room_id=room_id,
            a=a.stats,
            b=b.stats,
            bot_slots=[],            # two humans — no AI unless someone drops
            mods_a=a.mods,
            mods_b=b.mods,
            on_finish=_ON_FINISH,
        )
        room.mode = "pvp"
        room.wallets = {0: a.wallet, 1: b.wallet}
        room.agent_ids = {0: a.agent_id, 1: b.agent_id}
        room.skins = {0: a.skin, 1: b.skin}
        # legacy single-player fields still used by the solo reward path
        room.wallet = a.wallet
        room.agent_id = a.agent_id
        return room

    async def _await_seat(self, seat: Seat, on_cancel) -> tuple[Room, int] | None:
        """Wait to be paired, bailing out if the client goes away."""
        recv = asyncio.create_task(seat.ws.receive_text())
        try:
            done, _ = await asyncio.wait(
                {seat.future, recv},
                timeout=MATCH_TIMEOUT_S,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if seat.future in done:
                return seat.future.result()
            # Either the socket closed (receive raised) or the client sent
            # something while queued — in both cases they are no longer
            # waiting politely, so free the slot.
            await on_cancel(seat)
            if recv in done:
                try:
                    recv.result()
                except Exception:
                    return None          # disconnected
                return None              # sent a message = cancel
            return None                  # timed out
        finally:
            if not recv.done():
                recv.cancel()

    # -------------------------------------------------------------- random

    async def join_random(self, seat: Seat) -> tuple[Room, int] | None:
        async with self._lock:
            while self._queue:
                other = self._queue.pop(0)
                if other.future.done():
                    continue             # stale entry, already matched/cancelled
                room = self._pair(other, seat, f"pvp-{uuid.uuid4().hex[:8]}")
                other.future.set_result((room, 0))
                log.info("PvP matched %s vs %s in %s",
                         other.wallet[:8], seat.wallet[:8], room.room_id)
                return room, 1
            self._queue.append(seat)

        return await self._await_seat(seat, self._drop_random)

    async def _drop_random(self, seat: Seat) -> None:
        async with self._lock:
            if seat in self._queue:
                self._queue.remove(seat)

    # ------------------------------------------------------------- private

    async def join_private(self, seat: Seat, code: str) -> tuple[Room, int] | None:
        code = code.strip().lower()[:32]
        async with self._lock:
            host = self._private.get(code)
            if host is not None and not host.future.done():
                del self._private[code]
                room = self._pair(host, seat, f"pvp-{code}-{uuid.uuid4().hex[:6]}")
                host.future.set_result((room, 0))
                log.info("PvP private '%s' matched in %s", code, room.room_id)
                return room, 1
            self._private[code] = seat

        return await self._await_seat(seat, lambda s: self._drop_private(s, code))

    async def _drop_private(self, seat: Seat, code: str) -> None:
        async with self._lock:
            if self._private.get(code) is seat:
                del self._private[code]

    # ---------------------------------------------------------------- info

    async def waiting_count(self) -> int:
        async with self._lock:
            return sum(1 for s in self._queue if not s.future.done())


matchmaker = Matchmaker()

#: set by routers/combat.py at import time to avoid a circular import
_ON_FINISH = None


def set_on_finish(cb) -> None:
    global _ON_FINISH
    _ON_FINISH = cb
