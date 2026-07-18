import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .chain.listener import run_listener
from .config import get_settings
from .database import init_db
from .routers import (agents, battles, combat, leaderboard, leagues,
                      market, matchmaking, metadata, solo, tournaments,
                      users)

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(run_listener())
    yield
    task.cancel()


app = FastAPI(title="Agent Arena API", version="0.1.0", lifespan=lifespan)

import logging as _logging

_err_log = _logging.getLogger("arena.errors")


@app.middleware("http")
async def _catch_unhandled(request, call_next):
    try:
        return await call_next(request)
    except Exception:
        _err_log.exception("Unhandled error on %s %s",
                           request.method, request.url.path)
        return JSONResponse(status_code=500,
                            content={"detail": "Internal server error"})


# added last => outermost => decorates the catcher's responses too
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (users, agents, battles, leaderboard, metadata,
          tournaments, matchmaking, leagues, solo, combat, market):
    app.include_router(r.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
