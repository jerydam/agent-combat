from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database — Supabase Postgres in prod, sqlite for local dev
    database_url: str = "sqlite+aiosqlite:///./agent_arena.db"

    # BOT Chain
    rpc_url: str = ""
    chain_id: int = 677
    agent_nft_address: str = ""
    battle_arena_address: str = ""
    tournament_address: str = ""
    league_address: str = ""
    solo_arena_address: str = ""
    bot_owner_address: str = ""  # wallet that owns house bot agents

    # Backend game-signer key (NEVER the deployer key)
    game_server_private_key: str = ""

    # Listener
    poll_interval_seconds: float = 2.0

    cors_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
