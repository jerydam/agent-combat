"""Achievement room + market.

Flow:
- GET  /market/achievements/{wallet}  -> earned/claimable/claimed + points
- POST /market/claim                  -> claim satisfied achievements (points)
- GET  /market/catalog                -> the item catalog + on-chain prices
- POST /market/redeem                 -> spend points on an item
- POST /market/equip                  -> equip a skin/power on an agent you own
- POST /market/apply-boost            -> consume a boost item -> on-chain stats

BOT purchases happen on the Shop contract; the listener grants them into
the same inventory. All owner checks are wallet-signature-authenticated
(same EIP-191 pattern as league fixtures: sign "agent-arena:market:{action}").
"""

from __future__ import annotations

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..chain.wbot_price import get_wbot_price
from ..market.catalog import (
    ACHIEVEMENT_BY_ID,
    ACHIEVEMENTS,
    CATALOG,
    ITEM_BY_ID,
    POINTS_PER_USD,
    bot_price_wei,
    evaluate,
    usd_price,
)
from ..models import AgentCache, AgentLoadout, InventoryItem, PlayerProgress

router = APIRouter(prefix="/market", tags=["market"])


def _verify(wallet: str, signature: str, action: str) -> None:
    try:
        recovered = Account.recover_message(
            encode_defunct(text=f"agent-arena:market:{action}"),
            signature=signature,
        )
    except Exception:
        raise HTTPException(401, "Bad signature")
    if recovered.lower() != wallet.lower():
        raise HTTPException(403, "Signature does not match wallet")


async def _progress(db: AsyncSession, wallet: str) -> PlayerProgress:
    wallet = wallet.lower()
    p = await db.get(PlayerProgress, wallet)
    if p is None:
        p = PlayerProgress(wallet=wallet, points=0, claimed=[])
        db.add(p)
        await db.flush()
    return p


# ---------------------------------------------------------- achievements

@router.get("/achievements/{wallet}")
async def achievements(wallet: str, db: AsyncSession = Depends(get_db)):
    earned = await evaluate(db, wallet)
    p = await _progress(db, wallet)
    await db.commit()
    return {
        "points": p.points,
        "achievements": [
            {
                "id": a.id,
                "name": a.name,
                "desc": a.desc,
                "points": a.points,
                "earned": a.id in earned,
                "claimed": a.id in p.claimed,
            }
            for a in ACHIEVEMENTS
        ],
    }


class ClaimBody(BaseModel):
    wallet: str
    signature: str  # over "agent-arena:market:claim"


@router.post("/claim")
async def claim(body: ClaimBody, db: AsyncSession = Depends(get_db)):
    _verify(body.wallet, body.signature, "claim")
    earned = await evaluate(db, body.wallet)
    p = await _progress(db, body.wallet)
    new = [a for a in earned if a not in p.claimed]
    gained = sum(ACHIEVEMENT_BY_ID[a].points for a in new)
    p.claimed = [*p.claimed, *new]
    p.points += gained
    await db.commit()
    return {"claimed": new, "points_gained": gained, "points": p.points}


# ---------------------------------------------------------------- market

@router.get("/catalog")
async def catalog():
    """Items with all three price views: points, USD, and BOT wei.
    1000 points == 1 USD; BOT price = USD / live WBOT price (from the
    BDEX pair; env BOT_USD_PRICE is only the offline fallback)."""
    bot_usd = await get_wbot_price()
    return {
        "points_per_usd": POINTS_PER_USD,
        "bot_usd_price": bot_usd,
        "items": [
            {
                "id": i.id,
                "kind": i.kind,
                "name": i.name,
                "desc": i.desc,
                "point_price": i.point_price,
                "usd_price": round(usd_price(i), 2),
                "bot_price_wei": str(bot_price_wei(i, bot_usd)),
                "boost": i.boost,
                "power": i.power,
            }
            for i in CATALOG
        ],
    }


@router.get("/inventory/{wallet}")
async def inventory(wallet: str, db: AsyncSession = Depends(get_db)):
    rows = (
        (await db.execute(
            select(InventoryItem).where(InventoryItem.wallet == wallet.lower())
        )).scalars().all()
    )
    p = await _progress(db, wallet)
    await db.commit()
    return {
        "points": p.points,
        "items": [
            {"id": r.id, "item_id": r.item_id, "source": r.source,
             "consumed": r.consumed}
            for r in rows
        ],
    }


class RedeemBody(BaseModel):
    wallet: str
    item_id: str
    signature: str  # over "agent-arena:market:redeem:{item_id}"


@router.post("/redeem")
async def redeem(body: RedeemBody, db: AsyncSession = Depends(get_db)):
    item = ITEM_BY_ID.get(body.item_id)
    if item is None or item.point_price <= 0:
        raise HTTPException(404, "Item not redeemable")
    _verify(body.wallet, body.signature, f"redeem:{body.item_id}")
    p = await _progress(db, body.wallet)
    if p.points < item.point_price:
        raise HTTPException(400, f"Need {item.point_price} points, have {p.points}")
    # skins/powers are one-per-wallet; boosts stack
    if item.kind != "boost":
        owned = (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.wallet == body.wallet.lower(),
                    InventoryItem.item_id == item.id,
                )
            )
        ).scalar_one_or_none()
        if owned:
            raise HTTPException(400, "Already owned")
    p.points -= item.point_price
    db.add(InventoryItem(wallet=body.wallet.lower(), item_id=item.id, source="points"))
    await db.commit()
    return {"ok": True, "points": p.points}


class EquipBody(BaseModel):
    wallet: str
    token_id: int
    item_id: str  # skin or power; empty string = unequip
    signature: str  # over "agent-arena:market:equip:{token_id}:{item_id}"


@router.post("/equip")
async def equip(body: EquipBody, db: AsyncSession = Depends(get_db)):
    _verify(body.wallet, body.signature, f"equip:{body.token_id}:{body.item_id}")
    agent = await db.get(AgentCache, body.token_id)
    if agent is None or agent.owner.lower() != body.wallet.lower():
        raise HTTPException(403, "Not your agent")

    loadout = await db.get(AgentLoadout, body.token_id) or AgentLoadout(
        token_id=body.token_id
    )
    if body.item_id == "":
        loadout.skin = ""
    else:
        item = ITEM_BY_ID.get(body.item_id)
        if item is None or item.kind not in ("skin", "power"):
            raise HTTPException(404, "Not equippable")
        owned = (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.wallet == body.wallet.lower(),
                    InventoryItem.item_id == item.id,
                )
            )
        ).scalar_one_or_none()
        if not owned:
            raise HTTPException(400, "You don't own this item")
        if item.kind == "skin":
            loadout.skin = item.id
        else:
            loadout.power = item.id
    db.add(loadout)
    await db.commit()
    return {"ok": True, "skin": loadout.skin, "power": loadout.power}


@router.get("/loadout/{token_id}")
async def loadout(token_id: int, db: AsyncSession = Depends(get_db)):
    l = await db.get(AgentLoadout, token_id)
    return {"skin": l.skin if l else "", "power": l.power if l else ""}


class BoostBody(BaseModel):
    wallet: str
    token_id: int
    inventory_id: int
    signature: str  # over "agent-arena:market:boost:{inventory_id}:{token_id}"


@router.post("/apply-boost")
async def apply_boost(body: BoostBody, db: AsyncSession = Depends(get_db)):
    """Consume a boost item: server sends AgentNFT.boostStats on-chain."""
    _verify(
        body.wallet, body.signature,
        f"boost:{body.inventory_id}:{body.token_id}",
    )
    inv = await db.get(InventoryItem, body.inventory_id)
    if inv is None or inv.wallet != body.wallet.lower() or inv.consumed:
        raise HTTPException(404, "Boost not available")
    item = ITEM_BY_ID.get(inv.item_id)
    if item is None or item.kind != "boost" or item.boost is None:
        raise HTTPException(400, "Not a boost")
    agent = await db.get(AgentCache, body.token_id)
    if agent is None or agent.owner.lower() != body.wallet.lower():
        raise HTTPException(403, "Not your agent")

    # on-chain write from the game-server account
    from ..chain.boosts import send_boost

    tx_hash = await send_boost(body.token_id, item.boost)

    atk, dfs, spd, intel = item.boost
    agent.attack += atk
    agent.defense += dfs
    agent.speed += spd
    agent.intelligence += intel
    inv.consumed = True
    inv.tx_hash = tx_hash
    await db.commit()
    return {"ok": True, "tx_hash": tx_hash}
