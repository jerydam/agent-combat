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
from ..market.catalog import ITEM_BY_ID, avatar_mods, merge_mods
from ..models import (AgentCache, AgentLoadout, CombatMatchRecord,
                      PlayerProgress, SoloGame)
from ..combat.rooms import Room, manager
from ..combat.matchmaker import Seat, matchmaker, set_on_finish
from ..combat.coach import Coach

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
    """Submit this live fight's outcome for the staked SoloArena game.

    Order matters here. The result is written to the DB as `unsettled`
    BEFORE the chain is touched, so that if the tx fails — or this
    process dies mid-submit — the outcome the player actually earned is
    already durable and the listener's retry loop can finish the job.
    Submitting first and recording afterwards loses the result on every
    failure path, which is how a real win turns into "wait an hour and
    reclaim your own stake".
    """
    import asyncio

    m = room.match
    won = m.winner == 0
    async with SessionLocal() as db:
        g = await db.get(SoloGame, room.solo_game_id)
        if g is None or g.status != "pending":
            return {}
        stake_wei = g.stake_wei
    result_log = m.result_log()

    from ..chain.signer import moves_hash as _mh
    m_hash = _mh(result_log)
    payout = str(int(stake_wei) * 18 // 10) if won else "0"

    # 1. persist the earned outcome first — this is the retry's input
    async with SessionLocal() as db:
        g = await db.get(SoloGame, room.solo_game_id)
        g.status = "unsettled"
        g.player_won = won
        g.moves = result_log
        g.moves_hash = "0x" + m_hash.hex().removeprefix("0x")
        await db.commit()

    def _submit() -> str:
        from ..chain.client import get_contracts, get_w3
        from ..chain.listener import _send_tx

        w3 = get_w3()
        solo = get_contracts(w3)[4]
        if solo is None:
            raise RuntimeError("SOLO_ARENA_ADDRESS not configured")
        # _send_tx waits for the receipt and raises unless status == 1,
        # so reaching the next line means the payout really happened.
        return _send_tx(
            w3, solo.functions.submitResult(room.solo_game_id, won, m_hash)
        )

    try:
        tx_hash = await asyncio.get_event_loop().run_in_executor(None, _submit)
    except Exception as e:
        log.exception(
            "STAKE SETTLEMENT FAILED for solo game %s (won=%s, stake=%s). "
            "Result is saved as 'unsettled'; the listener will keep retrying. "
            "Most common cause: the game-server account is out of gas.",
            room.solo_game_id, won, stake_wei,
        )
        return {"stake": {"won": won, "settled": False,
                          "error": str(e)[:200],
                          "stake_wei": stake_wei,
                          "payout_wei": payout}}

    # 2. only now is it genuinely resolved on-chain
    async with SessionLocal() as db:
        g = await db.get(SoloGame, room.solo_game_id)
        g.status = "resolved"
        g.tx_hash = tx_hash
        await db.commit()

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


async def _load_player(wallet: str, agent_id: int | None, fallback_name: str):
    """(stats, mods, skin, name) for a player's chosen agent.

    Ownership is checked here rather than trusted from the client: a
    forged agent_id would otherwise let anyone fight with someone else's
    maxed-out agent and its avatar bonuses.
    """
    stats = None
    mods: dict = {}
    skin = ""
    if agent_id is not None:
        async with SessionLocal() as db:
            cached = await db.get(AgentCache, agent_id)
            if cached is not None and wallet and cached.owner.lower() == wallet.lower():
                loadout = await db.get(AgentLoadout, agent_id)
                if loadout:
                    skin = loadout.skin or ""
                    power = None
                    if loadout.power and (it := ITEM_BY_ID.get(loadout.power)) and it.power:
                        power = it.power
                    mods = merge_mods(avatar_mods(loadout.skin), power)
                stats = ChainStats(
                    token_id=cached.token_id,
                    name=cached.name,
                    personality=Personality(cached.personality),
                    attack=cached.attack, defense=cached.defense,
                    speed=cached.speed, intelligence=cached.intelligence,
                    level=cached.level, tier=1,
                )
    if stats is None:
        # no agent (or not theirs): fight as an even, unmodified stand-in
        agent_id = None
        mods = {}
        skin = ""
        stats = _synthetic(fallback_name, 0, 70, 1)
    return stats, mods, skin, stats.name, agent_id


async def _award_pvp(room: Room) -> dict:
    """Record a live PvP result for BOTH players.

    Returns a `by_slot` payload so each player only ever sees their own
    points and level-ups on the result screen.
    """
    m = room.match
    out: dict[str, dict] = {}

    async with SessionLocal() as db:
        for slot in (0, 1):
            wallet = (room.wallets.get(slot) or "").lower()
            agent_id = room.agent_ids.get(slot)
            won = m.winner == slot
            my, opp = m.score(slot), m.score(1 - slot)
            points = (WIN_BONUS + my // WIN_DIVISOR) if won else my // LOSS_DIVISOR
            if not wallet:
                continue

            prog = await db.get(PlayerProgress, wallet)
            if prog is None:
                prog = PlayerProgress(wallet=wallet, points=0, claimed=[])
                db.add(prog)
            prog.points += points

            leveled_up = False
            if agent_id is not None:
                agent = await db.get(AgentCache, agent_id)
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
                wallet=wallet, agent_id=agent_id, won=won,
                win_reason=m.win_reason, my_score=my, opp_score=opp,
                points_awarded=points,
            ))
            out[str(slot)] = {"reward": {
                "points": points, "total_points": prog.points,
                "won": won, "leveled_up": leveled_up,
            }}
        await db.commit()

    return {"by_slot": out} if out else {}


set_on_finish(_award_pvp)


@router.websocket("/ws/combat/pvp")
async def pvp(ws: WebSocket):
    """Live player-vs-player. Two humans, one authoritative engine.

    Query: wallet, agent_id, and optionally room=<code> for a private
    match with a friend instead of the open queue.
    """
    await ws.accept()
    q = ws.query_params

    wallet = (q.get("wallet") or "").lower()
    if not wallet:
        await ws.send_json({"kind": "error", "message": "Connect your wallet to play PvP"})
        await ws.close()
        return

    agent_id = int(q["agent_id"]) if q.get("agent_id") else None
    code = q.get("room") or ""

    stats, mods, skin, name, agent_id = await _load_player(wallet, agent_id, "Challenger")
    seat = Seat(ws=ws, wallet=wallet, agent_id=agent_id, stats=stats,
                mods=mods, skin=skin, name=name)

    await ws.send_json({
        "kind": "queued",
        "private": bool(code),
        "code": code or None,
        "waiting": await matchmaker.waiting_count(),
    })

    try:
        paired = (await matchmaker.join_private(seat, code) if code
                  else await matchmaker.join_random(seat))
    except Exception:
        log.exception("PvP matchmaking failed")
        paired = None

    if paired is None:
        try:
            await ws.send_json({
                "kind": "no_match",
                "message": "No opponent found. Try again, or fight the house AI.",
            })
            await ws.close()
        except Exception:
            pass
        return

    room, slot = paired
    opponent = room.match.f[1 - slot].stats

    await ws.send_json({
        "kind": "matched",
        "you": slot,
        "opponent": {
            "name": opponent.name,
            "skin": room.skins.get(1 - slot, ""),
            "level": opponent.level,
        },
    })

    await manager.join(room, slot, ws)

    try:
        while True:
            msg = await ws.receive_json()
            await manager.handle_input(room, slot, msg)
    except WebSocketDisconnect:
        await manager.leave(room, slot)
    except Exception:
        await manager.leave(room, slot)


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

    # The fighter's modifiers come from BOTH slots: the equipped avatar
    # (hit power / defence rate / attack speed / super charge, scaled to
    # what the avatar cost) and the equipped perk. merge_mods composes
    # them properly instead of one overwriting the other.
    mods_a: dict = {}
    if agent_id is not None:
        async with SessionLocal() as db:
            l = await db.get(AgentLoadout, agent_id)
        power_mods = None
        skin_mods = None
        if l:
            skin_mods = avatar_mods(l.skin)
            if l.power and (item := ITEM_BY_ID.get(l.power)) and item.power:
                power_mods = item.power
        mods_a = merge_mods(skin_mods, power_mods)

    room = manager.create(
        room_id=f"practice-{uuid.uuid4().hex[:8]}",
        a=me, b=bot, bot_slots=[1], mods_a=mods_a,
        on_finish=_award,
    )
    room.wallet = wallet
    room.agent_id = agent_id
    room.solo_game_id = solo_game_id
    # Training: attach the coach that freezes the fight at each teachable
    # moment. Nothing is recorded for a tutorial run.
    if q.get("tutorial") in ("1", "true", "yes"):
        room.coach = Coach()
        room.wallet = ""
        room.agent_id = None
        room.solo_game_id = None
    await manager.join(room, 0, ws)

    try:
        while True:
            msg = await ws.receive_json()
            await manager.handle_input(room, 0, msg)
    except WebSocketDisconnect:
        await manager.leave(room, 0)
    except Exception:
        await manager.leave(room, 0)
