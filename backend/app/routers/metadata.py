from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import AgentCache

router = APIRouter(prefix="/metadata", tags=["metadata"])

PERSONALITIES = {0: "Aggressive", 1: "Defensive", 2: "Tactical"}


@router.get("/{token_id}")
async def token_metadata(token_id: int, db: AsyncSession = Depends(get_db)):
    """ERC721 tokenURI target — AgentNFT baseURI points here."""
    a = await db.get(AgentCache, token_id)
    if a is None:
        raise HTTPException(404, "Agent not found")
    return {
        "name": f"{a.name} #{a.token_id}",
        "description": "An autonomous AI fighter in Agent Arena on BOT Chain.",
        "attributes": [
            {"trait_type": "Personality", "value": PERSONALITIES[a.personality]},
            {"trait_type": "Attack", "value": a.attack},
            {"trait_type": "Defense", "value": a.defense},
            {"trait_type": "Speed", "value": a.speed},
            {"trait_type": "Intelligence", "value": a.intelligence},
            {"trait_type": "Level", "value": a.level},
            {"trait_type": "Wins", "value": a.wins},
            {"trait_type": "Losses", "value": a.losses},
        ],
    }
