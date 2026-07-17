import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .chain.listener import run_listener
from .config import get_settings
from .database import init_db
from .routers import (agents, battles, combat, leaderboard, leagues,
                      matchmaking, metadata, solo, tournaments, users)

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(run_listener())
    yield
    task.cancel()


app = FastAPI(title="Agent Arena API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (users, agents, battles, leaderboard, metadata,
          tournaments, matchmaking, leagues, solo, combat):
    app.include_router(r.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
