"""Set prices on the Shop contract for all catalog items with point_price >= 1500.

Env vars (from .env):
    RPC_URL           RPC endpoint
    HOP_ADDRESS       deployed Shop contract address  (mapped from SHOP_ADDRESS)
    OWNER_PRIVATE_KEY private key of the Shop owner
    CHAIN_ID          (optional, derived from RPC if absent)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware


# ── inline catalog (no relative imports needed) ──────────────────────────────

@dataclass(frozen=True)
class ItemDef:
    id: str
    kind: str
    name: str
    desc: str
    point_price: int
    boost: tuple | None = None
    power: dict | None = None


CATALOG: list[ItemDef] = [
    ItemDef("av_ronin",      "skin", "Ronin",          "Wandering blade in crimson",                              600),
    ItemDef("av_guardian",   "skin", "Guardian",        "Tower-shield sentinel",                                   600),
    ItemDef("av_striker",    "skin", "Striker",         "Bare-knuckle brawler",                                    600),
    ItemDef("av_mystic",     "skin", "Mystic",          "Mind over muscle",                                        800),
    ItemDef("av_captain",    "skin", "Captain",         "Decorated arena veteran",                                 800),
    ItemDef("av_shadow",     "skin", "Shadow",          "Seen only when striking",                                1000),
    ItemDef("av_valkyrie",   "skin", "Valkyrie",        "Spear of the north",                                     1000),
    ItemDef("av_monk",       "skin", "Monk",            "A hundred parries a day",                                1000),
    ItemDef("av_cyber",      "skin", "Cyber Duelist",   "Neon augmented fighter",                                 1200),
    ItemDef("av_phantom",    "skin", "Phantom",         "Purple void ghost. Strikes from the abyss.",             1500),
    ItemDef("av_berserker",  "skin", "Berserker",       "Blazing orange rage fighter. High-ATK playstyle.",       1500),
    ItemDef("av_specter",    "skin", "Specter",         "Neon-green matrix hacker. High-INT tactical mind.",      1800),
    ItemDef("av_tempest",    "skin", "Tempest",         "Cyan lightning elemental. Built for pure speed.",        1800),
    ItemDef("av_ironclad",   "skin", "Ironclad",        "Silver/gunmetal tank. DEF-heavy and immovable.",         2000),
    ItemDef("av_oracle",     "skin", "Oracle",          "Purple psychic seer. Sees your next move already.",      2000),
    ItemDef("av_warlord",    "skin", "Warlord",         "Gold-trimmed armored commander. Prestige tournament feel.", 2000),
    ItemDef("av_champion",   "skin", "Champion",        "Golden crown of the arena",                              2000),
    ItemDef("av_ranger_red", "skin", "Red Ranger",      "Bold sentai front-liner. Aggressive and fearless.",      2500),
    ItemDef("av_ranger_blue","skin", "Blue Ranger",     "Cool-headed sentai tactician. Calm under pressure.",     2500),
    ItemDef("av_ranger_gold","skin", "Gold Ranger",     "Elite prestige variant. Reserved for tournament legends.", 4000),
    ItemDef("av_blaze",      "skin", "Blaze",           "Red-hot flame hero. Burns brighter than the rest.",      3000),
    ItemDef("av_nova",       "skin", "Nova",            "Cosmic energy warrior. Tactical and unstoppable.",       3500),
    ItemDef("av_volt",       "skin", "Volt",            "Blue/yellow electric speedster. Lightning reflexes.",    3000),
    ItemDef("av_titan",      "skin", "Titan",           "Hulking green tank. Immovable. Unbreakable.",            3500),
    ItemDef("boost_str",     "boost","Strength Serum",  "+5 ATK on-chain",                                        800, boost=(5,0,0,0)),
    ItemDef("boost_grit",    "boost","Grit Serum",      "+5 DEF on-chain",                                        800, boost=(0,5,0,0)),
    ItemDef("boost_agility", "boost","Agility Serum",   "+5 SPD on-chain",                                        800, boost=(0,0,5,0)),
    ItemDef("boost_mind",    "boost","Mind Serum",      "+5 INT on-chain",                                        800, boost=(0,0,0,5)),
    ItemDef("boost_omni",    "boost","Omni Serum",      "+3 to every stat on-chain",                             2000, boost=(3,3,3,3)),
    ItemDef("pw_second_wind","power","Second Wind",     "+20% stamina regen",                                    1000, power={"regen_mult": 1.2}),
    ItemDef("pw_iron_guard", "power","Iron Guard",      "Blocks absorb 6% more",                                 1000, power={"block_bonus": 0.06}),
    ItemDef("pw_focus_core", "power","Focus Core",      "Parry window +40ms",                                    1400, power={"parry_bonus_ms": 40}),
]

POINTS_PER_USD = 1000

def usd_price(item: ItemDef) -> float:
    return item.point_price / POINTS_PER_USD

def bot_price_wei(item: ItemDef, bot_usd: float) -> int:
    if bot_usd <= 0:
        return 0
    return int(round(usd_price(item) / bot_usd * 10**18))


# ── ABI ───────────────────────────────────────────────────────────────────────

SHOP_ABI = [
    {
        "name": "setPrice",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "itemId", "type": "string"},
            {"name": "price",  "type": "uint128"},
        ],
        "outputs": [],
    },
    {
        "name": "priceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs":  [{"name": "", "type": "string"}],
        "outputs": [{"name": "", "type": "uint128"}],
    },
    {
        "name": "owner",
        "type": "function",
        "stateMutability": "view",
        "inputs":  [],
        "outputs": [{"name": "", "type": "address"}],
    },
]


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",    action="store_true")
    parser.add_argument("--only",       nargs="*", default=None)
    parser.add_argument("--min-points", type=int,  default=1500)
    parser.add_argument("--force",      action="store_true",
                        help="re-set even if on-chain price already matches")
    args = parser.parse_args()

    rpc_url     = os.environ["RPC_URL"]
    # env uses HOP_ADDRESS; fall back to SHOP_ADDRESS if someone renames it
    shop_addr   = os.environ.get("HOP_ADDRESS") or os.environ["SHOP_ADDRESS"]
    private_key = os.environ["OWNER_PRIVATE_KEY"]

    shop_address = Web3.to_checksum_address(shop_addr)

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

    if not w3.is_connected():
        sys.exit(f"Cannot connect to RPC: {rpc_url}")

    account = w3.eth.account.from_key(private_key)
    shop    = w3.eth.contract(address=shop_address, abi=SHOP_ABI)

    onchain_owner = shop.functions.owner().call()
    if onchain_owner.lower() != account.address.lower():
        sys.exit(
            f"Signer {account.address} != Shop owner {onchain_owner}.\n"
            "setPrice will revert with OwnableUnauthorizedAccount."
        )

    bot_usd = 9.7
    print(f"BOT/USD  = {bot_usd}")
    print(f"Chain ID = {w3.eth.chain_id}")
    print(f"Signer   = {account.address}")
    print(f"Shop     = {shop_address}\n")

    # filter catalog
    items = [i for i in CATALOG if i.point_price >= args.min_points]
    if args.only:
        items = [i for i in items if i.id in args.only]
        missing = set(args.only) - {i.id for i in items}
        if missing:
            sys.exit(f"Unknown item id(s): {sorted(missing)}")

    if not items:
        sys.exit(f"No catalog items with point_price >= {args.min_points}.")

    print(f"Items matching point_price >= {args.min_points}: {len(items)}/{len(CATALOG)}\n")

    nonce   = w3.eth.get_transaction_count(account.address)
    chain_id = w3.eth.chain_id
    planned = []

    for item in items:
        target  = bot_price_wei(item, bot_usd)
        current = shop.functions.priceOf(item.id).call()
        if target == current and not args.force:
            print(f"  = {item.id:<20} unchanged  ({current} wei)")
            continue
        planned.append((item, current, target))

    if not planned:
        print("\nNothing to update.")
        return

    print(f"\n{len(planned)} item(s) to update:")
    for item, old, new in planned:
        arrow = "NEW" if old == 0 else f"{old} ->"
        print(f"  {item.id:<20} {arrow} {new} wei  (${usd_price(item):.2f})")

    if args.dry_run:
        print("\n--dry-run: no transactions sent.")
        return

    print()
    ok = 0
    for item, old, new in planned:
        try:
            tx = shop.functions.setPrice(item.id, new).build_transaction({
                "from":     account.address,
                "nonce":    nonce,
                "chainId":  chain_id,
                "gas":      80_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed  = account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            print(f"  ✓ {item.id:<20} tx {tx_hash.hex()}")
            nonce += 1
            ok    += 1
            time.sleep(0.2)
        except Exception as exc:
            print(f"  ✗ {item.id:<20} FAILED: {exc}")

    print(f"\n{ok}/{len(planned)} setPrice txs submitted.")
    if ok:
        print("Confirm on-chain before assuming they're mined.")


if __name__ == "__main__":
    main()