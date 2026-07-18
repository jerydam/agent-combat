"""Live WBOT/USD spot price from the BDEX V2 pair reserves.

Mirrors the frontend lib/getWBotPrice.ts so the catalog API and any
on-chain price syncing use the same number: price = stable_reserve /
wbot_reserve on the WBOT/stable pair. 60s in-memory cache; on failure we
serve the stale cache, then settings.bot_usd_price as the last resort.
"""

from __future__ import annotations

import asyncio
import logging
import time

from web3 import Web3

from ..config import get_settings

log = logging.getLogger("arena.wbot_price")

BDEX_V2_FACTORY = "0x117115f3B72C8d1989178089A67D0C26f8EE0AA3"
WBOT_ADDRESS = "0xD5452816194a3784dBa983426cCe7c122F4abd30"
# Confirm on scan.botchain.ai — "Common Tokens (Mainnet)"
STABLE_ADDRESS = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C"  # USDT/USDC
STABLE_DECIMALS = 6
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
_cached: tuple[float, float] | None = None  # (price, fetched_at)


def _fetch_sync() -> float:
    s = get_settings()
    w3 = Web3(Web3.HTTPProvider(s.rpc_url, request_kwargs={"timeout": 8}))
    factory = w3.eth.contract(
        address=Web3.to_checksum_address(BDEX_V2_FACTORY), abi=FACTORY_ABI
    )
    pair_addr = factory.functions.getPair(
        Web3.to_checksum_address(WBOT_ADDRESS),
        Web3.to_checksum_address(STABLE_ADDRESS),
    ).call()
    if int(pair_addr, 16) == 0:
        raise RuntimeError("WBOT/stable pair not found on BDEX V2")

    pair = w3.eth.contract(address=pair_addr, abi=PAIR_ABI)
    r0, r1, _ = pair.functions.getReserves().call()
    token0 = pair.functions.token0().call()

    wbot_is_0 = token0.lower() == WBOT_ADDRESS.lower()
    reserve_wbot = r0 if wbot_is_0 else r1
    reserve_stable = r1 if wbot_is_0 else r0

    wbot = reserve_wbot / 10**WBOT_DECIMALS
    stable = reserve_stable / 10**STABLE_DECIMALS
    if wbot == 0:
        raise RuntimeError("Zero WBOT reserve")

    price = stable / wbot
    if price <= 0 or price > 100_000:
        raise RuntimeError(f"Suspicious price: {price}")
    return price


async def get_wbot_price() -> float:
    """Current WBOT/USD. Cached 60s; stale cache, then env fallback."""
    global _cached
    now = time.monotonic()
    if _cached and now - _cached[1] < CACHE_TTL_S:
        return _cached[0]
    try:
        price = await asyncio.get_event_loop().run_in_executor(None, _fetch_sync)
        _cached = (price, now)
        return price
    except Exception as exc:
        log.warning("WBOT price fetch failed (%s); using fallback", exc)
        if _cached:
            return _cached[0]
        return get_settings().bot_usd_price
