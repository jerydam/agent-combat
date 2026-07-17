from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database — Supabase Postgres in prod, sqlite for local dev
    database_url: str = "sqlite+aiosqlite:///./agent_arena.db"

    # BOT Chain
    rpc_url: str = "https://rpc.bohr.life"
    chain_id: int = 698
    agent_nft_address: str = ""
    battle_arena_address: str = ""
    tournament_address: str = ""
    league_address: str = ""
    solo_arena_address: str = ""
    shop_address: str = ""
    bot_owner_address: str = "0x9F2B0118CedB3d24748448D6D091a31F163c121e"  # wallet that owns house bot agents

    # Backend game-signer key (NEVER the deployer key)
    game_server_private_key: str = ""

    # Listener
    poll_interval_seconds: float = 2.0

    cors_origins: str = "https://www.agentcombat.xyz"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # Forgive common paste mistakes in DATABASE_URL: stray "DATABASE_URL="
    # prefix, wrapping quotes, whitespace, and a missing +asyncpg driver.
    url = s.database_url.strip().strip('"').strip("'")
    if url.upper().startswith("DATABASE_URL="):
        url = url.split("=", 1)[1].strip()
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    # asyncpg rejects sslmode=; Supabase pooler is SSL regardless
    url = url.replace("?sslmode=require", "").replace("&sslmode=require", "")
    s.database_url = url
    return s