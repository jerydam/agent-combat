from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import AgentCache, SoloGame

router = APIRouter(prefix="/solo", tags=["solo"])

# Mirrors SoloArena.sol's RECLAIM_AFTER. A pending game older than this
# can have its stake pulled back by the player via reclaim(gameId) —
# on-chain, no backend involvement needed.
RECLAIM_AFTER = timedelta(hours=1)


@router.get("/bots")
async def list_bots(db: AsyncSession = Depends(get_db)):
    """House bots, easiest to hardest — mint them from the bot wallet,
    then SoloArena.setBot(id, true). Free play: play(agent, bot) with 0
    value; staked: send BOT, beat the bot, win 1.8x."""
    owner = get_settings().bot_owner_address.lower()
    if not owner:
        return []
    q = select(AgentCache).where(AgentCache.owner == owner)
    bots = (await db.execute(q)).scalars().all()
    bots.sort(key=lambda b: (b.level, b.attack + b.defense + b.speed + b.intelligence))
    return [
        {
            "token_id": b.token_id,
            "name": b.name,
            "level": b.level,
            "personality": b.personality,
            "attack": b.attack,
            "defense": b.defense,
            "speed": b.speed,
            "intelligence": b.intelligence,
            "wins": b.wins,
            "losses": b.losses,
        }
        for b in bots
    ]


@router.get("/games")
async def list_games(
    agent_id: int | None = None,
    player: str | None = None,
    status: str | None = None,
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(SoloGame).order_by(SoloGame.game_id.desc()).limit(limit)
    if agent_id is not None:
        q = q.where(SoloGame.agent_id == agent_id)
    if player is not None:
        q = q.where(SoloGame.player == player.lower())
    if status is not None:
        q = q.where(SoloGame.status == status)
    rows = (await db.execute(q)).scalars().all()
    cutoff = datetime.now(timezone.utc) - RECLAIM_AFTER
    return [
        {
            "game_id": g.game_id,
            "agent_id": g.agent_id,
            "bot_id": g.bot_id,
            "stake_wei": g.stake_wei,
            "status": g.status,
            "player_won": g.player_won,
            "tx_hash": g.tx_hash,
            # True once the fight never got a live result AND the
            # contract's 1h window has passed — the player can pull the
            # stake back themselves with SoloArena.reclaim(gameId).
            "reclaimable": (
                g.status == "pending"
                and g.created_at is not None
                and g.created_at < cutoff
            ),
        }
        for g in rows
    ]


@router.get("/games/{game_id}")
async def get_game(game_id: int, db: AsyncSession = Depends(get_db)):
    g = await db.get(SoloGame, game_id)
    if g is None:
        raise HTTPException(404, "Game not found")
    return {
        "game_id": g.game_id,
        "agent_id": g.agent_id,
        "bot_id": g.bot_id,
        "player": g.player,
        "stake_wei": g.stake_wei,
        "status": g.status,
        "player_won": g.player_won,
        "moves": g.moves,
        "moves_hash": g.moves_hash,
        "tx_hash": g.tx_hash,
    }