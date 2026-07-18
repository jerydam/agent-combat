"""Async engine setup.

Supabase notes — the two classic 500-makers:
- The DIRECT db host (db.<ref>.supabase.co:5432) is IPv6-only; many PaaS
  runners (Koyeb included) have no IPv6, so every query fails with a
  connect error. Use the POOLER host (aws-0-<region>.pooler.supabase.com).
- The pooler's transaction mode breaks asyncpg's named prepared
  statements (DuplicatePreparedStatement). We disable statement caching
  and give prepared statements unique names, and skip SQLAlchemy's own
  pooling (pgbouncer already pools).
"""

from uuid import uuid4

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    url = get_settings().database_url
    if url.startswith("postgresql+asyncpg"):
        return create_async_engine(
            url,
            echo=False,
            poolclass=NullPool,  # pgbouncer pools; don't double-pool
            connect_args={
                "statement_cache_size": 0,
                "prepared_statement_name_func": lambda: f"__aa_{uuid4().hex}__",
            },
        )
    # sqlite (local dev/tests): asyncpg-only args would break the driver
    return create_async_engine(url, echo=False)


engine = _make_engine()

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
