from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import AgentCache

router = APIRouter(prefix="/matchmaking", tags=["matchmaking"])


@router.get("/{token_id}")
async def find_opponents(
    token_id: int,
    limit: int = Query(5, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Opponents closest in ELO, excluding the caller's own agents.
    The UI shows these as challenge / quick-match targets."""
    me = await db.get(AgentCache, token_id)
    if me is None:
        raise HTTPException(404, "Agent not found")
    q = select(AgentCache).where(
        AgentCache.token_id != token_id, AgentCache.owner != me.owner
    )
    candidates = (await db.execute(q)).scalars().all()
    candidates.sort(
        key=lambda a: (abs(a.ranking_points - me.ranking_points), a.token_id)
    )
    return [
        {
            "token_id": a.token_id,
            "name": a.name,
            "level": a.level,
            "ranking_points": a.ranking_points,
            "wins": a.wins,
            "losses": a.losses,
            "elo_gap": abs(a.ranking_points - me.ranking_points),
        }
        for a in candidates[:limit]
    ]
