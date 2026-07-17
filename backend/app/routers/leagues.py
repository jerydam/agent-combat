"""League rooms: live standings and async fixture play.

Playing a fixture requires an EIP-191 signature from the initiator agent's
owner wallet over the message "agent-arena:play:{league_id}:{fixture_idx}"
— so only the real owner can play their fixtures, without needing any
session system.
"""

from datetime import datetime, timezone

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..engine.agent_engine import FighterState, Personality
from ..engine.league import compute_standings, fixture_seed
from ..engine.memory import head_to_head
from ..engine.simulator import simulate
from ..models import AgentCache, Fixture, LeagueRecord

router = APIRouter(prefix="/leagues", tags=["leagues"])


class PlayFixtureBody(BaseModel):
    wallet: str
    signature: str  # EIP-191 over "agent-arena:play:{league_id}:{idx}"


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


async def _fixtures_of(db: AsyncSession, league_id: int) -> list[Fixture]:
    return (
        (await db.execute(select(Fixture).where(Fixture.league_id == league_id)))
        .scalars()
        .all()
    )


def _fixture_dicts(fixtures: list[Fixture]) -> list[dict]:
    return [
        {
            "index": f.idx,
            "initiator": f.initiator,
            "opponent": f.opponent,
            "status": f.status,
            "winner": f.winner,
            "hp_diff": f.hp_diff,
        }
        for f in fixtures
    ]


@router.get("")
async def list_leagues(
    limit: int = Query(20, le=100), db: AsyncSession = Depends(get_db)
):
    q = (
        select(LeagueRecord)
        .order_by(LeagueRecord.league_id.desc())
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "league_id": r.league_id,
            "status": r.status,
            "start_time": r.start_time,
            "end_time": r.end_time,
            "entrants": r.entrants,
        }
        for r in rows
    ]


@router.get("/{league_id}")
async def get_league(league_id: int, db: AsyncSession = Depends(get_db)):
    """Room + fixtures + LIVE standings (recomputed on every read while
    active; frozen copy stored at resolution)."""
    r = await db.get(LeagueRecord, league_id)
    if r is None:
        raise HTTPException(404, "League not found")
    fixtures = await _fixtures_of(db, league_id)
    live = compute_standings(r.entrants, _fixture_dicts(fixtures))
    return {
        "league_id": r.league_id,
        "status": r.status,
        "start_time": r.start_time,
        "end_time": r.end_time,
        "entrants": r.entrants,
        "fixtures": _fixture_dicts(fixtures),
        "standings": r.standings if r.status == "resolved" else live,
        "standings_hash": r.standings_hash,
        "tx_hash": r.tx_hash,
    }


@router.get("/{league_id}/fixtures/{agent_id}")
async def my_fixtures(
    league_id: int, agent_id: int, db: AsyncSession = Depends(get_db)
):
    """The fixtures this agent initiates — its 'home games' to play."""
    fixtures = await _fixtures_of(db, league_id)
    mine = [f for f in fixtures if f.initiator == agent_id]
    if not mine:
        raise HTTPException(404, "No fixtures for this agent in this league")
    return _fixture_dicts(mine)


@router.post("/{league_id}/fixtures/{idx}/play")
async def play_fixture_endpoint(
    league_id: int,
    idx: int,
    body: PlayFixtureBody,
    db: AsyncSession = Depends(get_db),
):
    """Play one of your fixtures. Async by design: the opponent's agent
    fights autonomously — its owner doesn't need to be online."""
    r = await db.get(LeagueRecord, league_id)
    if r is None or r.status != "active":
        raise HTTPException(400, "League is not active")
    now = int(datetime.now(timezone.utc).timestamp())
    if not (r.start_time <= now < r.end_time):
        raise HTTPException(400, "Outside the league window")

    fixture = (
        await db.execute(
            select(Fixture).where(
                Fixture.league_id == league_id, Fixture.idx == idx
            )
        )
    ).scalar_one_or_none()
    if fixture is None:
        raise HTTPException(404, "Fixture not found")
    if fixture.status != "pending":
        raise HTTPException(400, f"Fixture already {fixture.status}")

    # ---- auth: initiator agent's owner must sign the play request ----
    initiator_agent = await db.get(AgentCache, fixture.initiator)
    opponent_agent = await db.get(AgentCache, fixture.opponent)
    if initiator_agent is None or opponent_agent is None:
        raise HTTPException(404, "Agent not found")

    message = f"agent-arena:play:{league_id}:{idx}"
    try:
        recovered = Account.recover_message(
            encode_defunct(text=message), signature=body.signature
        )
    except Exception:
        raise HTTPException(401, "Bad signature")
    if (
        recovered.lower() != body.wallet.lower()
        or recovered.lower() != initiator_agent.owner.lower()
    ):
        raise HTTPException(403, "Signer does not own the initiating agent")

    # ---- deterministic battle from the on-chain league seed ----
    fa = _to_fighter(initiator_agent)
    fb = _to_fighter(opponent_agent)
    mem = await head_to_head(db, fa.token_id, fb.token_id)
    fa.memory_vs_opponent = mem
    fb.memory_vs_opponent = (mem[1], mem[0])

    seed = fixture_seed(int(r.seed), fa.token_id, fb.token_id)
    battle_log = simulate(fa, fb, seed)

    fixture.status = "played"
    fixture.winner = battle_log["winner"]
    a, b = battle_log["agent_a"], battle_log["agent_b"]
    a_pct, b_pct = a["final_hp"] / a["max_hp"], b["final_hp"] / b["max_hp"]
    fixture.hp_diff = (
        a_pct - b_pct if a["token_id"] == fa.token_id else b_pct - a_pct
    )
    fixture.log = battle_log
    fixture.played_at = datetime.now(timezone.utc)
    await db.commit()

    fixtures = await _fixtures_of(db, league_id)
    return {
        "fixture": idx,
        "battle": battle_log,
        "standings": compute_standings(r.entrants, _fixture_dicts(fixtures)),
    }
