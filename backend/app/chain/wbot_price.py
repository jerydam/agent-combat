"""Live WBOT/USD spot price from the BDEX V2 pair reserves.

Single source of truth for the game's BOT price: the frontend reads it
from /market/catalog instead of calling the DEX itself.

The pair lives on Botchain MAINNET; the game contracts live on the game
chain (settings.rpc_url). This module therefore reads from
settings.price_rpc_url — never the game RPC.

Behavior:
- Verifies the factory address actually has code on the mainnet RPC
  before calling it; if not (wrong address / wrong RPC), logs ONCE and
  uses settings.bot_usd_price without spamming errors.
- 60s cache for successes; 60s negative-cache for failures so a broken
  DEX config doesn't hammer the RPC on every catalog request.
- All addresses/decimals are env-configurable (BDEX_FACTORY_ADDRESS,
  WBOT_ADDRESS, STABLE_ADDRESS, STABLE_DECIMALS).
"""

from __future__ import annotations

import asyncio
import logging
import time

from web3 import Web3

from ..config import get_settings

log = logging.getLogger("arena.wbot_price")

WBOT_DECIMALS = 18

FACTORY_ABI = [{
    "name": "getPair", "type": "function", "stateMutability": "view",
    "inputs": [{"name": "tokenA", "type": "address"},
               {"name": "tokenB", "type": "address"}],
    "outputs": [{"name": "pair", "type": "address"}],
}]
PAIR_ABI = [
    {"name": "getReserves", "type": "function", "stateMutability": "view",
     "inputs": [],
     "outputs": [{"name": "reserve0", "type": "uint112"},
                 {"name": "reserve1", "type": "uint112"},
                 {"name": "blockTimestampLast", "type": "uint32"}]},
    {"name": "token0", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "address"}]},
]

CACHE_TTL_S = 60.0
_cached: tuple[float, float] | None = None   # (price, fetched_at)
_failed_at: float | None = None              # negative cache
_warned_no_code = False


def _fetch_sync() -> float:
    global _warned_no_code
    s = get_settings()
    # MAINNET RPC — the pair does not exist on the game chain
    w3 = Web3(Web3.HTTPProvider(s.price_rpc_url, request_kwargs={"timeout": 8}))

    factory_addr = Web3.to_checksum_address(s.bdex_factory_address)
    if w3.eth.get_code(factory_addr) in (b"", b"\x00"):
        if not _warned_no_code:
            log.warning(
                "BDEX factory %s has no code on %s — check PRICE_RPC_URL "
                "(must be Botchain MAINNET) and BDEX_FACTORY_ADDRESS/"
                "WBOT_ADDRESS/STABLE_ADDRESS; using BOT_USD_PRICE=%.4f meanwhile",
                factory_addr, s.price_rpc_url, s.bot_usd_price,
            )
            _warned_no_code = True
        raise RuntimeError("factory not deployed on this RPC")

    factory = w3.eth.contract(address=factory_addr, abi=FACTORY_ABI)
    pair_addr = factory.functions.getPair(
        Web3.to_checksum_address(s.wbot_address),
        Web3.to_checksum_address(s.stable_address),
    ).call()
    if int(pair_addr, 16) == 0:
        raise RuntimeError("WBOT/stable pair not found on BDEX V2")

    pair = w3.eth.contract(address=pair_addr, abi=PAIR_ABI)
    r0, r1, _ = pair.functions.getReserves().call()
    token0 = pair.functions.token0().call()

    wbot_is_0 = token0.lower() == s.wbot_address.lower()
    reserve_wbot = r0 if wbot_is_0 else r1
    reserve_stable = r1 if wbot_is_0 else r0

    wbot = reserve_wbot / 10**WBOT_DECIMALS
    stable = reserve_stable / 10**s.stable_decimals
    if wbot == 0:
        raise RuntimeError("Zero WBOT reserve")

    price = stable / wbot
    if price <= 0 or price > 100_000:
        raise RuntimeError(f"Suspicious price: {price}")
    return price


async def get_wbot_price() -> float:
    """Current WBOT/USD. Cached 60s; stale cache, then env fallback."""
    global _cached, _failed_at
    now = time.monotonic()
    if _cached and now - _cached[1] < CACHE_TTL_S:
        return _cached[0]
    if _failed_at and now - _failed_at < CACHE_TTL_S:
        return _cached[0] if _cached else get_settings().bot_usd_price
    try:
        price = await asyncio.get_event_loop().run_in_executor(None, _fetch_sync)
        _cached = (price, now)
        _failed_at = None
        return price
    except Exception as exc:
        _failed_at = now
        log.debug("WBOT price fetch failed (%s); using fallback", exc)
        return _cached[0] if _cached else get_settings().bot_usd_price
