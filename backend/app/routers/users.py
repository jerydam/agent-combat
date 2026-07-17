from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserOut

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserOut)
async def upsert_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    """Create the player profile on first wallet connect (idempotent)."""
    wallet = body.wallet.lower()
    user = (
        await db.execute(select(User).where(User.wallet == wallet))
    ).scalar_one_or_none()
    if user is None:
        user = User(wallet=wallet, username=body.username)
        db.add(user)
    elif body.username:
        user.username = body.username
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{wallet}", response_model=UserOut)
async def get_user(wallet: str, db: AsyncSession = Depends(get_db)):
    user = (
        await db.execute(select(User).where(User.wallet == wallet.lower()))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(404, "User not found")
    return user
