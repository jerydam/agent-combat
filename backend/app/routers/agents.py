import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
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
        q = q.where(func.lower(AgentCache.owner) == owner.lower())
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


class SyncBody(BaseModel):
    owner: str


@router.post("/sync")
async def sync_from_chain(body: SyncBody, db: AsyncSession = Depends(get_db)):
    """Mirror this wallet's minted agents straight from the chain.

    The listener only indexes blocks after it boots, so a mint made while
    the backend was down never reaches the cache. The dashboard calls this
    when it looks empty (and after every mint) to backfill from AgentMinted
    logs filtered by owner.
    """
    from ..config import get_settings
    from ..chain.client import get_contracts, get_w3

    s = get_settings()
    if not (s.rpc_url and s.agent_nft_address):
        raise HTTPException(503, "Chain not configured")

    def _scan() -> list[dict]:
        w3 = get_w3()
        nft = get_contracts(w3)[0]
        events = nft.events.AgentMinted().get_logs(
            from_block=0,
            argument_filters={"owner": w3.to_checksum_address(body.owner)},
        )
        out = []
        for ev in events:
            a = ev["args"]
            try:  # live stats beat mint-time stats (boosts, levels)
                (st, name) = nft.functions.getAgent(a["tokenId"]).call()
                atk, dfs, spd, intel, level, wins, losses, xp, _lb, pers, _t = st
                out.append(dict(token_id=a["tokenId"], name=name,
                                personality=pers, attack=atk, defense=dfs,
                                speed=spd, intelligence=intel, level=level))
            except Exception:
                out.append(dict(token_id=a["tokenId"], name=a["name"],
                                personality=a["personality"], attack=a["attack"],
                                defense=a["defense"], speed=a["speed"],
                                intelligence=a["intelligence"], level=1))
        return out

    try:
        found = await asyncio.get_event_loop().run_in_executor(None, _scan)
    except Exception as exc:
        raise HTTPException(502, f"Chain scan failed: {exc}")

    added = 0
    for rec in found:
        existing = await db.get(AgentCache, rec["token_id"])
        if existing is None:
            db.add(AgentCache(owner=body.owner.lower(), **rec))
            added += 1
        else:
            existing.owner = body.owner.lower()
    await db.commit()
    return {"found": len(found), "added": added}

