"""Combat WebSocket endpoints — this IS solo mode.

Free play: connect to
  /ws/combat/practice?personality=0&bot_personality=2&difficulty=60
and fight a bot immediately. Add &wallet=0x..(&agent_id=..) and the match
IS recorded: the wallet earns achievement points every fight, and a real
agent's wins/losses/XP move.

Staked play: call SoloArena.play(agentId, botId) with BOT attached, then
connect with &game_id=<gameId>&wallet=&agent_id=. The result of THIS live
fight is what the server submits on-chain (submitResult) — win and the
contract pays 1.8x. Abandoned staked games are swept by the listener so
stakes never lock. The on-chain botId is only an escrow reference; the
opponent you actually fight is the tap AI at your chosen difficulty.

Rewards (wallet connected):
  win:  50 pts + score/10   loss: score/20   (see _award)
Messages client -> server: {"type":"attack","heavy":bool} | {"type":"defend"}
Messages server -> client: countdown / fight / state / result
The result message carries win_reason (ko|score|hp|tiebreak) and, when a
wallet was attached, a `reward` object.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database import SessionLocal
from ..engine.agent_engine import FighterState as ChainStats, Personality
from ..market.catalog import ITEM_BY_ID
from ..models import (AgentCache, AgentLoadout, CombatMatchRecord,
                      PlayerProgress, SoloGame)
from ..combat.rooms import Room, manager

log = logging.getLogger("arena.combat")

router = APIRouter(tags=["combat"])

WIN_BONUS = 50
LOSS_DIVISOR = 20
WIN_DIVISOR = 10
XP_WIN = 40
XP_LOSS = 10
XP_PER_LEVEL = 100


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


async def _settle_stake(room: Room) -> dict:
    """Submit this live fight's outcome for the staked SoloArena game."""
    import asyncio

    m = room.match
    won = m.winner == 0
    async with SessionLocal() as db:
        g = await db.get(SoloGame, room.solo_game_id)
        if g is None or g.status != "pending":
            return {}
        stake_wei = g.stake_wei
    result_log = m.result_log()

    def _submit() -> str:
        from ..chain.client import get_contracts, get_w3
        from ..chain.listener import _send_tx
        from ..chain.signer import moves_hash

        w3 = get_w3()
        solo = get_contracts(w3)[4]
        return _send_tx(
            w3,
            solo.functions.submitResult(
                room.solo_game_id, won, moves_hash(result_log)
            ),
        )

    try:
        tx_hash = await asyncio.get_event_loop().run_in_executor(None, _submit)
    except Exception:
        log.exception("submitResult failed for solo game %s (sweeper will retry)",
                      room.solo_game_id)
        return {"stake": {"won": won, "settled": False,
                          "stake_wei": stake_wei, "payout_wei": "0"}}

    from ..chain.signer import moves_hash as _mh

    async with SessionLocal() as db:
        g = await db.get(SoloGame, room.solo_game_id)
        g.status = "resolved"
        g.player_won = won
        g.moves = result_log
        g.moves_hash = _mh(result_log).hex()
        g.tx_hash = tx_hash
        await db.commit()

    payout = str(int(stake_wei) * 18 // 10) if won else "0"
    return {"stake": {"won": won, "settled": True, "tx_hash": tx_hash,
                      "stake_wei": stake_wei, "payout_wei": payout}}


async def _award(room: Room) -> dict:
    """on_finish: record the match, grant rewards, settle any stake.
    Returns the payload merged into the result broadcast."""
    m = room.match
    extra: dict = {}
    if room.solo_game_id is not None:
        extra.update(await _settle_stake(room))
    if not room.wallet:
        return extra
    won = m.winner == 0
    my, opp = m.score(0), m.score(1)
    points = (WIN_BONUS + my // WIN_DIVISOR) if won else my // LOSS_DIVISOR

    async with SessionLocal() as db:
        prog = await db.get(PlayerProgress, room.wallet)
        if prog is None:
            prog = PlayerProgress(wallet=room.wallet, points=0, claimed=[])
            db.add(prog)
        prog.points += points

        leveled_up = False
        if room.agent_id is not None:
            agent = await db.get(AgentCache, room.agent_id)
            if agent is not None:
                if won:
                    agent.wins += 1
                else:
                    agent.losses += 1
                agent.experience += XP_WIN if won else XP_LOSS
                while agent.experience >= agent.level * XP_PER_LEVEL:
                    agent.experience -= agent.level * XP_PER_LEVEL
                    agent.level += 1
                    leveled_up = True

        db.add(CombatMatchRecord(
            wallet=room.wallet,
            agent_id=room.agent_id,
            won=won,
            win_reason=m.win_reason,
            my_score=my,
            opp_score=opp,
            points_awarded=points,
        ))
        await db.commit()
        total = prog.points

    extra["reward"] = {
        "points": points,
        "total_points": total,
        "won": won,
        "leveled_up": leveled_up,
    }
    return extra


@router.websocket("/ws/combat/practice")
async def practice(ws: WebSocket):
    await ws.accept()
    q = ws.query_params

    wallet = (q.get("wallet") or "").lower()
    agent_id = int(q["agent_id"]) if q.get("agent_id") else None

    # Staked solo: the game must be indexed, pending, and owned by this
    # wallet. The listener indexes SoloPlayed within ~2 blocks; retry
    # briefly to cover the race with the tx confirmation.
    solo_game_id: int | None = None
    if q.get("game_id"):
        import asyncio as _aio

        gid = int(q["game_id"])
        for _ in range(12):
            async with SessionLocal() as db:
                g = await db.get(SoloGame, gid)
            if g is not None:
                break
            await _aio.sleep(1)
        if g is None or g.status != "pending":
            await ws.send_json({"kind": "error",
                                "message": "Staked game not found or already settled"})
            await ws.close()
            return
        if not wallet or g.player.lower() != wallet:
            await ws.send_json({"kind": "error",
                                "message": "This staked game belongs to another wallet"})
            await ws.close()
            return
        solo_game_id = gid
        agent_id = agent_id or g.agent_id

    me = None
    if agent_id is not None:
        me = await _from_cache(agent_id)
    if me is None:
        agent_id = None  # unknown agent: fight, but don't credit a ghost
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
    if agent_id is not None:
        async with SessionLocal() as db:
            l = await db.get(AgentLoadout, agent_id)
        if l and l.power and (item := ITEM_BY_ID.get(l.power)) and item.power:
            mods_a = dict(item.power)

    room = manager.create(
        room_id=f"practice-{uuid.uuid4().hex[:8]}",
        a=me, b=bot, bot_slots=[1], mods_a=mods_a,
        on_finish=_award,
    )
    room.wallet = wallet
    room.agent_id = agent_id
    room.solo_game_id = solo_game_id
    await manager.join(room, 0, ws)

    try:
        while True:
            msg = await ws.receive_json()
            await manager.handle_input(room, 0, msg)
    except WebSocketDisconnect:
        await manager.leave(room, 0)
    except Exception:
        await manager.leave(room, 0)
