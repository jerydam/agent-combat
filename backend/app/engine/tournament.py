"""Tournament engine.

Everything derives deterministically from the on-chain bracketSeed:
- the bracket (entrant order shuffled by seed)
- every match seed: keccak-free, pure-Python derivation via
  sha256(bracket_seed, round, match_index)

Odd entrant counts are handled with byes (highest-seeded odd one out
advances). The full bracket record — pairings, per-match seeds, and every
battle log — is hashed into bracketHash and committed on-chain via
submitPodium, so the entire tournament is publicly replayable.
"""

from __future__ import annotations

import hashlib
import json
import random

from .agent_engine import FighterState
from .simulator import simulate


def match_seed(bracket_seed: int, round_no: int, match_idx: int) -> int:
    h = hashlib.sha256(
        f"{bracket_seed}:{round_no}:{match_idx}".encode()
    ).digest()
    return int.from_bytes(h, "big")


def build_bracket(bracket_seed: int, entrant_ids: list[int]) -> list[int]:
    """Deterministic first-round order: sort, then seed-shuffle."""
    order = sorted(entrant_ids)
    random.Random(bracket_seed).shuffle(order)
    return order


def run_tournament(
    bracket_seed: int,
    fighters: dict[int, FighterState],
) -> dict:
    """Simulate the whole single-elimination bracket.

    `fighters` maps token_id -> FighterState (fresh state; each match gets
    fresh copies so HP doesn't carry between rounds).

    Returns the full tournament record including podium (first, second,
    third). Third place = the semifinal loser that eliminated more HP% —
    deterministic, no extra match needed for MVP.
    """
    import copy

    order = build_bracket(bracket_seed, list(fighters))
    rounds: list[dict] = []
    current = order
    round_no = 0
    semifinal_losers: list[tuple[int, float]] = []  # (agent, final hp_pct)
    runner_up = 0

    while len(current) > 1:
        round_no += 1
        next_round: list[int] = []
        matches: list[dict] = []

        # Bye: odd one out advances automatically
        byes = []
        if len(current) % 2 == 1:
            byes = [current[-1]]
            current = current[:-1]

        is_semifinal = (len(current) + len(byes)) == 4 and not byes

        for idx in range(0, len(current), 2):
            a_id, b_id = current[idx], current[idx + 1]
            seed = match_seed(bracket_seed, round_no, idx // 2)
            a = copy.deepcopy(fighters[a_id])
            b = copy.deepcopy(fighters[b_id])
            log = simulate(a, b, seed)
            winner = log["winner"]
            loser = b_id if winner == a_id else a_id
            loser_hp = (
                log["agent_b"]["final_hp"] / log["agent_b"]["max_hp"]
                if loser == b_id
                else log["agent_a"]["final_hp"] / log["agent_a"]["max_hp"]
            )
            if is_semifinal:
                semifinal_losers.append((loser, loser_hp))
            matches.append(
                {
                    "round": round_no,
                    "match": idx // 2,
                    "seed": str(seed),
                    "agent_a": a_id,
                    "agent_b": b_id,
                    "winner": winner,
                    "battle": log,
                }
            )
            next_round.append(winner)

        rounds.append({"round": round_no, "matches": matches, "byes": byes})
        if len(next_round) + len(byes) == 2 and (next_round + byes):
            # the upcoming final's loser is the runner-up
            pass
        current = next_round + byes

    first = current[0]
    # Runner-up: loser of the last played match (the final)
    final_match = rounds[-1]["matches"][-1]
    runner_up = (
        final_match["agent_b"]
        if final_match["winner"] == final_match["agent_a"]
        else final_match["agent_a"]
    )
    # Third: semifinal loser with the better surviving HP%; fall back to
    # any earlier-round loser deterministically if bracket was tiny/odd.
    if semifinal_losers:
        semifinal_losers.sort(key=lambda t: (-t[1], t[0]))
        third = semifinal_losers[0][0]
    else:
        eliminated = [
            m["agent_b"] if m["winner"] == m["agent_a"] else m["agent_a"]
            for r in rounds
            for m in r["matches"]
            if m["winner"] not in (first, runner_up)
        ]
        third = sorted(set(eliminated))[0] if eliminated else 0

    record = {
        "bracket_seed": str(bracket_seed),
        "entrants": sorted(fighters),
        "initial_order": order,
        "rounds": rounds,
        "podium": {"first": first, "second": runner_up, "third": third},
    }
    return record


def bracket_hash(record: dict) -> bytes:
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
    # keccak256 to match on-chain expectations
    from web3 import Web3

    return Web3.keccak(canonical)
