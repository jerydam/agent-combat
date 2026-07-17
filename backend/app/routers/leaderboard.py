from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import AgentCache
from ..schemas import AgentOut

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[AgentOut])
async def leaderboard(
    limit: int = Query(25, le=100), db: AsyncSession = Depends(get_db)
):
    q = (
        select(AgentCache)
        .order_by(
            AgentCache.ranking_points.desc(),
            AgentCache.wins.desc(),
            AgentCache.token_id.asc(),
        )
        .limit(limit)
    )
    return (await db.execute(q)).scalars().all()
