from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import TournamentRecord

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


@router.get("")
async def list_tournaments(
    limit: int = Query(20, le=100), db: AsyncSession = Depends(get_db)
):
    q = (
        select(TournamentRecord)
        .order_by(TournamentRecord.tournament_id.desc())
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "tournament_id": t.tournament_id,
            "status": t.status,
            "entrants": t.entrants,
            "podium": t.podium,
            "tx_hash": t.tx_hash,
        }
        for t in rows
    ]


@router.get("/{tid}")
async def get_tournament(tid: int, db: AsyncSession = Depends(get_db)):
    """Full bracket record — every pairing, match seed, and battle log.
    Hash it and compare against the on-chain bracketHash to audit."""
    t = await db.get(TournamentRecord, tid)
    if t is None:
        raise HTTPException(404, "Tournament not found")
    return {
        "tournament_id": t.tournament_id,
        "status": t.status,
        "bracket_seed": t.bracket_seed,
        "entrants": t.entrants,
        "bracket": t.bracket,
        "bracket_hash": t.bracket_hash,
        "podium": t.podium,
        "tx_hash": t.tx_hash,
    }
