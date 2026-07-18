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

    # Market fallback only: BOT/USD used when the live BDEX price fetch
    # fails and there is no cached value yet. Live price wins otherwise.
    # Until the real BDEX addresses below are confirmed, THIS is the price
    # the whole game uses — keep it current.
    bot_usd_price: float = 9.7

    # BDEX pair lookup for the live WBOT/USD price. The pair lives on
    # Botchain MAINNET while the game runs on rpc_url (testnet), so the
    # price fetch uses its own RPC. Override any of these via env:
    # PRICE_RPC_URL / BDEX_FACTORY_ADDRESS / WBOT_ADDRESS /
    # STABLE_ADDRESS / STABLE_DECIMALS.
    price_rpc_url: str = "https://rpc.botchain.ai"
    bdex_factory_address: str = "0x117115f3B72C8d1989178089A67D0C26f8EE0AA3"
    wbot_address: str = "0xD5452816194a3784dBa983426cCe7c122F4abd30"
    stable_address: str = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C"
    stable_decimals: int = 6

    # Listener
    poll_interval_seconds: float = 2.0

    cors_origins: str = "https://www.agentcombat.xyz"

    class Config:
        env_file = ".env"
        # never crash the whole backend because the env has extra keys
        # (deployer address, marketplace address, etc.)
        extra = "ignore"


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