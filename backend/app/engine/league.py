"""League fixtures engine.

Design (async play):
- Double round-robin: every ordered pair (A, B) is one fixture, INITIATED
  by A. So each player owns exactly (n-1) fixtures — their "home games".
- A player can come online any time inside the league window and play
  their own fixtures; the opponent does NOT need to be online (agents are
  autonomous). The opponent plays the reverse fixture whenever they log in.
- Fixture outcomes are deterministic from the on-chain league seed:
  seed_fixture = sha256(league_seed, initiator, opponent). Playing a
  fixture reveals and records it; not playing by the end time = forfeit.
- Points (accrue to the INITIATOR of each fixture):
    win 3 · loss 1 (you showed up) · forfeit 0
  Comparing both players' totals across all their fixtures decides the
  table — exactly the "A duels when online, B duels when online, compare
  total score" flow.
- Tiebreaks: total HP% differential across played fixtures, then wins,
  then lowest token id (all deterministic).

The full standings record (table + every fixture log) is hashed into
standingsHash and committed on-chain via submitStandings.
"""

from __future__ import annotations

import hashlib
import json

from .agent_engine import FighterState
from .simulator import simulate


def fixture_seed(league_seed: int, initiator: int, opponent: int) -> int:
    h = hashlib.sha256(f"{league_seed}:{initiator}:{opponent}".encode()).digest()
    return int.from_bytes(h, "big")


def generate_fixtures(entrant_ids: list[int]) -> list[dict]:
    """All ordered pairs — each entrant initiates one fixture vs every
    other entrant. Deterministic order."""
    ids = sorted(entrant_ids)
    fixtures = []
    idx = 0
    for a in ids:
        for b in ids:
            if a == b:
                continue
            fixtures.append(
                {"index": idx, "initiator": a, "opponent": b, "status": "pending"}
            )
            idx += 1
    return fixtures


def play_fixture(
    league_seed: int,
    initiator: FighterState,
    opponent: FighterState,
) -> dict:
    """Simulate one fixture deterministically. Returns the battle log."""
    seed = fixture_seed(league_seed, initiator.token_id, opponent.token_id)
    return simulate(initiator, opponent, seed)


def hp_diff(log: dict, initiator_id: int) -> float:
    a, b = log["agent_a"], log["agent_b"]
    a_pct = a["final_hp"] / a["max_hp"]
    b_pct = b["final_hp"] / b["max_hp"]
    return a_pct - b_pct if a["token_id"] == initiator_id else b_pct - a_pct


def compute_standings(
    entrant_ids: list[int], fixtures: list[dict]
) -> list[dict]:
    """Points table from fixtures. Each fixture must carry status
    ('played'|'pending'|'forfeit') and, if played, 'winner' and 'hp_diff'
    (from the initiator's perspective)."""
    table = {
        aid: {"agent": aid, "points": 0, "played": 0, "wins": 0,
              "losses": 0, "forfeits": 0, "hp_diff": 0.0}
        for aid in entrant_ids
    }
    for f in fixtures:
        row = table[f["initiator"]]
        if f["status"] == "played":
            row["played"] += 1
            row["hp_diff"] += f.get("hp_diff", 0.0)
            if f["winner"] == f["initiator"]:
                row["wins"] += 1
                row["points"] += 3
            else:
                row["losses"] += 1
                row["points"] += 1
        elif f["status"] == "forfeit":
            row["forfeits"] += 1

    standings = sorted(
        table.values(),
        key=lambda r: (-r["points"], -r["hp_diff"], -r["wins"], r["agent"]),
    )
    for pos, row in enumerate(standings, 1):
        row["position"] = pos
        row["hp_diff"] = round(row["hp_diff"], 4)
    return standings


def standings_hash(record: dict) -> bytes:
    from web3 import Web3

    canonical = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
    return Web3.keccak(canonical)
