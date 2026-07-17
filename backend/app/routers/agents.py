from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..engine.agent_engine import FighterState, Personality
from ..engine.simulator import simulate
from ..models import AgentCache, AgentLoadout
from ..schemas import AgentOut

router = APIRouter(prefix="/agents", tags=["agents"])


def _to_fighter(a: AgentCache) -> FighterState:
    return FighterState(
        token_id=a.token_id,
        name=a.name,
        personality=Personality(a.personality),
        attack=a.attack,
        defense=a.defense,
        speed=a.speed,
        intelligence=a.intelligence,
        level=a.level,
    )


async def _with_skins(db: AsyncSession, agents: list[AgentCache]) -> list[dict]:
    ids = [a.token_id for a in agents]
    skins: dict[int, str] = {}
    if ids:
        rows = (
            await db.execute(
                select(AgentLoadout).where(AgentLoadout.token_id.in_(ids))
            )
        ).scalars().all()
        skins = {r.token_id: r.skin for r in rows}
    return [
        {**{c.name: getattr(a, c.name) for c in AgentCache.__table__.columns},
         "skin": skins.get(a.token_id, "")}
        for a in agents
    ]


@router.get("", response_model=list[AgentOut])
async def list_agents(
    owner: str | None = None,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    q = select(AgentCache).limit(limit)
    if owner:
        q = q.where(AgentCache.owner == owner)
    agents = (await db.execute(q)).scalars().all()
    return await _with_skins(db, agents)


@router.get("/{token_id}", response_model=AgentOut)
async def get_agent(token_id: int, db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentCache, token_id)
    if agent is None:
        raise HTTPException(404, "Agent not found")
    return (await _with_skins(db, [agent]))[0]


@router.get("/{token_id}/preview")
async def preview_battle(
    token_id: int,
    opponent_id: int,
    seed: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Off-chain sparring: simulate a battle without touching the chain.
    This is the doc's Battle Training — test matchups, awards nothing.
    """
    a = await db.get(AgentCache, token_id)
    b = await db.get(AgentCache, opponent_id)
    if a is None or b is None:
        raise HTTPException(404, "Agent not found")
    return simulate(_to_fighter(a), _to_fighter(b), seed)
