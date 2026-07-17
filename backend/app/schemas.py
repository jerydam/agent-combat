from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserCreate(BaseModel):
    wallet: str
    username: str = ""


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    wallet: str
    username: str
    created_at: datetime


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    token_id: int
    owner: str
    name: str
    personality: int
    attack: int
    defense: int
    speed: int
    intelligence: int
    level: int
    experience: int
    wins: int
    losses: int
    ranking_points: int


class BattleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    battle_id: int
    agent_a: int
    agent_b: int
    status: str
    winner_agent: int
    moves: dict
    moves_hash: str
    tx_hash: str
    created_at: datetime
    resolved_at: datetime | None
