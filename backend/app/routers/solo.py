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
            # True once the stake is still escrowed on-chain AND the
            # contract's 1h window has passed — the player can pull it
            # back themselves with SoloArena.reclaim(gameId).
            #
            # "unsettled" counts too: the fight WAS played and the result
            # is known, but the settlement tx hasn't landed. The backend
            # keeps retrying, and if it never succeeds the player must
            # still be able to recover their money rather than have it
            # sit in escrow forever.
            "reclaimable": (
                g.status in ("pending", "unsettled")
                and g.created_at is not None
                and g.created_at < cutoff
            ),
            # a won-but-unsettled game is money the player is still owed
            "awaiting_payout": g.status == "unsettled" and bool(g.player_won),
        }
        for g in rows
    ]


@router.get("/health")
async def payout_health():
    """Is the staking system actually able to pay winners right now?

    Exists because the failure this detects is invisible from inside the
    game: fights play perfectly, the player sees VICTORY, and the payout
    silently never happens. The three things that break it are all
    readable from the chain, so the UI can warn *before* someone stakes.
    """
    from eth_account import Account
    from web3 import Web3

    from ..chain.client import get_contracts, get_w3

    s = get_settings()
    out: dict = {
        "ok": False,
        "can_pay_gas": False,
        "signer_authorized": False,
        "house_funded": False,
        "max_stake_wei": "0",
        "problems": [],
    }

    if not s.solo_arena_address:
        out["problems"].append("SOLO_ARENA_ADDRESS is not configured")
        return out
    if not s.game_server_private_key:
        out["problems"].append("Game server key is not configured")
        return out

    try:
        w3 = get_w3()
        solo = get_contracts(w3)[4]
        signer = Account.from_key(s.game_server_private_key).address

        gas_balance = w3.eth.get_balance(signer)
        out["can_pay_gas"] = gas_balance > 0
        if gas_balance == 0:
            out["problems"].append(
                "The game server wallet has no BOT for gas, so wins cannot be "
                "paid out on-chain."
            )

        onchain_server = solo.functions.gameServer().call()
        out["signer_authorized"] = onchain_server.lower() == signer.lower()
        if not out["signer_authorized"]:
            out["problems"].append(
                "The game server wallet is not the one the contract trusts."
            )

        bankroll = w3.eth.get_balance(solo.address)
        reserved = solo.functions.reserved().call()
        free = max(0, bankroll - reserved)
        max_stake = free * 10 // 8
        out["max_stake_wei"] = str(max_stake)
        out["house_funded"] = max_stake > 0
        if max_stake == 0:
            out["problems"].append(
                "The prize pool is empty — new stakes will be rejected."
            )
    except Exception as e:  # RPC down, wrong address, etc.
        out["problems"].append(f"Could not reach the chain: {str(e)[:150]}")
        return out

    out["ok"] = (
        out["can_pay_gas"] and out["signer_authorized"] and out["house_funded"]
    )
    return out


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