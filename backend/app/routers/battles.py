from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Battle
from ..schemas import BattleOut

router = APIRouter(prefix="/battles", tags=["battles"])


@router.get("", response_model=list[BattleOut])
async def list_battles(
    agent_id: int | None = None,
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Battle).order_by(Battle.battle_id.desc()).limit(limit)
    if agent_id is not None:
        q = q.where(or_(Battle.agent_a == agent_id, Battle.agent_b == agent_id))
    return (await db.execute(q)).scalars().all()


@router.get("/{battle_id}", response_model=BattleOut)
async def get_battle(battle_id: int, db: AsyncSession = Depends(get_db)):
    """Full battle log — hash it yourself and compare with the on-chain
    movesHash to verify the replay."""
    battle = await db.get(Battle, battle_id)
    if battle is None:
        raise HTTPException(404, "Battle not found")
    return battle
