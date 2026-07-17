from datetime import datetime

from sqlalchemy import (JSON, DateTime, Float, ForeignKey, Integer,
                        String, func)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class User(Base):
    """Player profile, created on first wallet connect."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    wallet: Mapped[str] = mapped_column(String(42), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AgentCache(Base):
    """Off-chain mirror of on-chain agents, refreshed by the chain client.

    The chain is the source of truth for stats; this cache exists so the
    leaderboard and matchmaking don't need an RPC call per row.
    """

    __tablename__ = "agents"

    token_id: Mapped[int] = mapped_column(primary_key=True)
    owner: Mapped[str] = mapped_column(String(42), index=True)
    name: Mapped[str] = mapped_column(String(32), default="")
    personality: Mapped[int] = mapped_column(Integer, default=0)
    attack: Mapped[int] = mapped_column(Integer, default=0)
    defense: Mapped[int] = mapped_column(Integer, default=0)
    speed: Mapped[int] = mapped_column(Integer, default=0)
    intelligence: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[int] = mapped_column(Integer, default=1)
    experience: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    ranking_points: Mapped[int] = mapped_column(Integer, default=1000)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TournamentRecord(Base):
    """Mirror of on-chain tournaments + the full resolved bracket record
    (the replay behind the on-chain bracketHash)."""

    __tablename__ = "tournaments"

    tournament_id: Mapped[int] = mapped_column(primary_key=True)  # on-chain
    status: Mapped[str] = mapped_column(String(16), default="registration")
    entry_fee_wei: Mapped[str] = mapped_column(String(40), default="0")
    bracket_seed: Mapped[str] = mapped_column(String(80), default="")
    entrants: Mapped[list] = mapped_column(JSON, default=list)
    bracket: Mapped[dict] = mapped_column(JSON, default=dict)
    bracket_hash: Mapped[str] = mapped_column(String(66), default="")
    podium: Mapped[dict] = mapped_column(JSON, default=dict)
    tx_hash: Mapped[str] = mapped_column(String(66), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class LeagueRecord(Base):
    """Mirror of on-chain league rooms + resolution record."""

    __tablename__ = "leagues"

    league_id: Mapped[int] = mapped_column(primary_key=True)  # on-chain
    status: Mapped[str] = mapped_column(String(16), default="registration")
    seed: Mapped[str] = mapped_column(String(80), default="")
    start_time: Mapped[int] = mapped_column(Integer, default=0)  # unix
    end_time: Mapped[int] = mapped_column(Integer, default=0)
    entrants: Mapped[list] = mapped_column(JSON, default=list)
    standings: Mapped[list] = mapped_column(JSON, default=list)
    standings_hash: Mapped[str] = mapped_column(String(66), default="")
    tx_hash: Mapped[str] = mapped_column(String(66), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Fixture(Base):
    """One async league fixture, owned by its initiator."""

    __tablename__ = "fixtures"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.league_id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    initiator: Mapped[int] = mapped_column(Integer, index=True)
    opponent: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="pending")
    winner: Mapped[int] = mapped_column(Integer, default=0)
    hp_diff: Mapped[float] = mapped_column(Float, default=0.0)
    log: Mapped[dict] = mapped_column(JSON, default=dict)
    played_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SoloGame(Base):
    """Mirror of on-chain solo (vs bot) games + full battle log."""

    __tablename__ = "solo_games"

    game_id: Mapped[int] = mapped_column(primary_key=True)  # on-chain
    agent_id: Mapped[int] = mapped_column(Integer, index=True)
    bot_id: Mapped[int] = mapped_column(Integer)
    player: Mapped[str] = mapped_column(String(42), default="")
    stake_wei: Mapped[str] = mapped_column(String(40), default="0")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    player_won: Mapped[bool] = mapped_column(default=False)
    moves: Mapped[dict] = mapped_column(JSON, default=dict)
    moves_hash: Mapped[str] = mapped_column(String(66), default="")
    tx_hash: Mapped[str] = mapped_column(String(66), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PlayerProgress(Base):
    """Wallet-level achievement points and claim tracking."""

    __tablename__ = "player_progress"

    wallet: Mapped[str] = mapped_column(String(42), primary_key=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    claimed: Mapped[list] = mapped_column(JSON, default=list)  # achievement ids


class InventoryItem(Base):
    """Items a wallet owns (from redemption or BOT purchase)."""

    __tablename__ = "inventory"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    wallet: Mapped[str] = mapped_column(String(42), index=True)
    item_id: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(12), default="points")  # points|bot
    consumed: Mapped[bool] = mapped_column(default=False)  # boosts consume
    tx_hash: Mapped[str] = mapped_column(String(66), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AgentLoadout(Base):
    """Cosmetic + perk loadout per agent (off-chain)."""

    __tablename__ = "agent_loadouts"

    token_id: Mapped[int] = mapped_column(primary_key=True)
    skin: Mapped[str] = mapped_column(String(32), default="")   # item id
    power: Mapped[str] = mapped_column(String(32), default="")  # item id


class Battle(Base):
    """Full battle record. `moves` is the complete round-by-round log whose
    keccak hash is committed on-chain as movesHash (auditable replay)."""

    __tablename__ = "battles"

    battle_id: Mapped[int] = mapped_column(primary_key=True)  # on-chain id
    agent_a: Mapped[int] = mapped_column(ForeignKey("agents.token_id"))
    agent_b: Mapped[int] = mapped_column(ForeignKey("agents.token_id"))
    seed: Mapped[str] = mapped_column(String(80))  # uint256 as decimal str
    status: Mapped[str] = mapped_column(String(16), default="pending")
    winner_agent: Mapped[int] = mapped_column(Integer, default=0)
    moves: Mapped[dict] = mapped_column(JSON, default=dict)
    moves_hash: Mapped[str] = mapped_column(String(66), default="")
    tx_hash: Mapped[str] = mapped_column(String(66), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
