"""Combat WebSocket endpoints.

Practice mode (zero setup): connect to
  /ws/combat/practice?personality=0&bot_personality=2&difficulty=60
and fight a bot immediately — stats are synthetic, nothing is recorded.
With ?agent_id= / ?bot_id= present, real cached stats are used instead.

Messages client -> server: {"type":"attack","heavy":bool} | {"type":"defend"}
Messages server -> client: countdown / fight / state / result
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database import SessionLocal
from ..engine.agent_engine import FighterState as ChainStats, Personality
from ..market.catalog import ITEM_BY_ID
from ..models import AgentCache, AgentLoadout
from ..combat.rooms import manager

router = APIRouter(tags=["combat"])


def _synthetic(name: str, personality: int, power: int, token_id: int) -> ChainStats:
    """A test fighter for practice mode. power 40..90 sets all stats."""
    p = max(40, min(90, power))
    return ChainStats(
        token_id=token_id,
        name=name,
        personality=Personality(personality % 3),
        attack=p, defense=p, speed=p, intelligence=p,
        level=1,
        tier=1,
    )


async def _from_cache(agent_id: int) -> ChainStats | None:
    async with SessionLocal() as db:
        a = await db.get(AgentCache, agent_id)
        if a is None:
            return None
        return ChainStats(
            token_id=a.token_id,
            name=a.name,
            personality=Personality(a.personality),
            attack=a.attack, defense=a.defense,
            speed=a.speed, intelligence=a.intelligence,
            level=a.level,
            tier=1,
        )


@router.websocket("/ws/combat/practice")
async def practice(ws: WebSocket):
    await ws.accept()
    q = ws.query_params

    me = None
    if q.get("agent_id"):
        me = await _from_cache(int(q["agent_id"]))
    if me is None:
        me = _synthetic("You", int(q.get("personality", 0)), int(q.get("power", 70)), 1)

    bot = None
    if q.get("bot_id"):
        bot = await _from_cache(int(q["bot_id"]))
    if bot is None:
        bot = _synthetic(
            "Sparring Bot",
            int(q.get("bot_personality", 1)),
            int(q.get("difficulty", 60)),
            2,
        )

    mods_a: dict = {}
    if q.get("agent_id"):
        async with SessionLocal() as db:
            l = await db.get(AgentLoadout, int(q["agent_id"]))
        if l and l.power and (item := ITEM_BY_ID.get(l.power)) and item.power:
            mods_a = dict(item.power)

    room = manager.create(
        room_id=f"practice-{uuid.uuid4().hex[:8]}",
        a=me, b=bot, bot_slots=[1], mods_a=mods_a,
    )
    await manager.join(room, 0, ws)

    try:
        while True:
            msg = await ws.receive_json()
            await manager.handle_input(room, 0, msg)
    except WebSocketDisconnect:
        await manager.leave(room, 0)
    except Exception:
        await manager.leave(room, 0)
