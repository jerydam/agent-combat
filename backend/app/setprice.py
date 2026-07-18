"""Sync CATALOG prices onto the on-chain Shop contract.

For every item in market.catalog.CATALOG, computes the BOT-wei price at the
current BOT/USD rate and calls Shop.setPrice(itemId, price) as the contract
owner. Safe to re-run: setPrice always overwrites, so this doubles as a
repricing job you can put on a schedule (recommended — priceOf is static,
BOT/USD isn't).

Usage (run from backend/, as a module, so `app.market.catalog`'s relative
imports resolve — plain `python app/setprice.py` will NOT work):
    python3.12 -m app.setprice                      # price qualifying items
    python3.12 -m app.setprice --dry-run             # show what would be set, no txs
    python3.12 -m app.setprice --only av_ronin boost_str   # subset

Env vars required:
    RPC_URL          RPC endpoint for the target chain (Celo or Botchain)
    SHOP_ADDRESS     deployed Shop contract address
    OWNER_PRIVATE_KEY  private key of the Shop's `owner()` account
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware  # needed on some L2s/sidechains

try:
    from dotenv import load_dotenv
    load_dotenv()  # picks up backend/.env when run from backend/ via -m
except ImportError:
    pass  # python-dotenv not installed — rely on already-exported env vars

# catalog.py does `from ..models import (...)`, so it must be imported as
# part of the app package (app.market.catalog) — not as a bare top-level
# module. Run this script with `python3.12 -m app.setprice` from the
# backend/ directory (see usage note below), which puts backend/ on
# sys.path and makes this import resolve correctly.
from app.market.catalog import CATALOG, bot_price_wei  # noqa: E402

SHOP_ABI = [
    {
        "name": "setPrice",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "itemId", "type": "string"},
            {"name": "price", "type": "uint128"},
        ],
        "outputs": [],
    },
    {
        "name": "priceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "", "type": "string"}],
        "outputs": [{"name": "", "type": "uint128"}],
    },
    {
        "name": "owner",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address"}],
    },
]


def get_current_bot_usd() -> float:
    """Return the current BOT/USD price.

    TODO: point this at whatever your backend already uses to compute
    `bot_price_wei` in the /market/catalog response (BDEX reserve read,
    same source getWBotPrice() mirrors on the frontend). Keeping this in
    one place means the on-chain price and the price shown in the UI never
    disagree.
    """
    raise NotImplementedError(
        "Wire this up to your existing BOT/USD price source "
        "(the same one that feeds bot_price_wei in /market/catalog)."
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only", nargs="*", default=None, help="subset of item ids")
    parser.add_argument(
        "--min-points", type=int, default=1500,
        help="only price items with point_price >= this (default: 1500)",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="set price even if it already matches on-chain (default: skip unchanged)",
    )
    args = parser.parse_args()

    rpc_url = os.environ["RPC_URL"]
    shop_address = Web3.to_checksum_address(os.environ["SHOP_ADDRESS"])
    private_key = os.environ["OWNER_PRIVATE_KEY"]

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    account = w3.eth.account.from_key(private_key)
    shop = w3.eth.contract(address=shop_address, abi=SHOP_ABI)

    onchain_owner = shop.functions.owner().call()
    if onchain_owner.lower() != account.address.lower():
        sys.exit(
            f"Signer {account.address} is not the Shop owner ({onchain_owner}). "
            "setPrice will revert with OwnableUnauthorizedAccount."
        )

    bot_usd = 9.7
    if bot_usd <= 0:
        sys.exit(f"Bad BOT/USD price: {bot_usd}")
    print(f"BOT/USD = {bot_usd}")

    items = [i for i in CATALOG if i.point_price >= args.min_points]
    if args.only:
        items = [i for i in items if i.id in args.only]
        missing = set(args.only) - {i.id for i in items}
        # also flag ids that exist in CATALOG but got excluded by --min-points,
        # so a typo'd id and a too-cheap id don't look the same
        excluded_by_price = {
            i.id for i in CATALOG
            if i.id in args.only and i.point_price < args.min_points
        }
        if excluded_by_price:
            sys.exit(
                f"Item id(s) below --min-points {args.min_points}: {sorted(excluded_by_price)} "
                "— lower --min-points or omit them."
            )
        if missing:
            sys.exit(f"Unknown item id(s): {sorted(missing)}")

    if not items:
        sys.exit(f"No catalog items with point_price >= {args.min_points}.")

    print(f"Filter: point_price >= {args.min_points}  ({len(items)}/{len(CATALOG)} catalog items match)")

    nonce = w3.eth.get_transaction_count(account.address)
    chain_id = w3.eth.chain_id
    planned = []

    for item in items:
        target_price = bot_price_wei(item, bot_usd)
        current_price = shop.functions.priceOf(item.id).call()
        if target_price == current_price and not args.force:
            print(f"  = {item.id:<16} unchanged ({current_price} wei)")
            continue
        planned.append((item, current_price, target_price))

    if not planned:
        print("Nothing to update.")
        return

    print(f"\n{len(planned)} item(s) to update:")
    for item, old, new in planned:
        print(f"  {item.id:<16} {old} -> {new} wei")

    if args.dry_run:
        print("\n--dry-run: no transactions sent.")
        return

    print()
    for item, old, new in planned:
        tx = shop.functions.setPrice(item.id, new).build_transaction({
            "from": account.address,
            "nonce": nonce,
            "chainId": chain_id,
            "gas": 80_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        print(f"  {item.id:<16} sent {tx_hash.hex()}")
        nonce += 1
        time.sleep(0.2)  # avoid RPC rate limiting on rapid sequential sends

    print("\nAll setPrice txs submitted. Confirm on-chain before assuming they're mined.")


if __name__ == "__main__":
    main()