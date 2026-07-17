"""Engine tests: determinism, auditability, and rough balance.

Run: python -m pytest tests/ -v   (or just: python tests/test_engine.py)
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine.agent_engine import FighterState, Personality
from app.engine.simulator import simulate


def make(token_id, pers, atk=70, dfs=60, spd=65, intel=70, level=1):
    return FighterState(
        token_id=token_id,
        name=f"Agent{token_id}",
        personality=pers,
        attack=atk,
        defense=dfs,
        speed=spd,
        intelligence=intel,
        level=level,
    )


def test_determinism():
    """Same seed + same stats => byte-identical battle log."""
    for seed in (1, 42, 2**200 + 7):
        log1 = simulate(
            make(1, Personality.AGGRESSIVE), make(2, Personality.TACTICAL), seed
        )
        log2 = simulate(
            make(1, Personality.AGGRESSIVE), make(2, Personality.TACTICAL), seed
        )
        c1 = json.dumps(log1, sort_keys=True, separators=(",", ":"))
        c2 = json.dumps(log2, sort_keys=True, separators=(",", ":"))
        assert c1 == c2, "battle must be reproducible from its seed"
    print("PASS determinism")


def test_different_seeds_differ():
    logs = {
        json.dumps(
            simulate(
                make(1, Personality.AGGRESSIVE),
                make(2, Personality.AGGRESSIVE),
                seed,
            ),
            sort_keys=True,
        )
        for seed in range(20)
    }
    assert len(logs) > 15, "seeds should produce varied battles"
    print("PASS seed variety")


def test_battle_terminates_with_winner():
    for seed in range(50):
        log = simulate(
            make(1, Personality.DEFENSIVE, atk=50, dfs=90),
            make(2, Personality.DEFENSIVE, atk=50, dfs=90),
            seed,
        )
        assert log["winner"] in (1, 2)
        assert log["total_rounds"] <= 25
    print("PASS termination")


def test_personality_balance():
    """No personality should dominate at equal stats. Rough check over
    matchup grid; warn rather than fail on mild imbalance."""
    wins = Counter()
    matchups = [
        (Personality.AGGRESSIVE, Personality.DEFENSIVE),
        (Personality.AGGRESSIVE, Personality.TACTICAL),
        (Personality.DEFENSIVE, Personality.TACTICAL),
    ]
    n = 300
    for p1, p2 in matchups:
        for seed in range(n):
            log = simulate(make(1, p1), make(2, p2), seed)
            winner_pers = p1 if log["winner"] == 1 else p2
            wins[winner_pers.name] += 1

    total = sum(wins.values())
    print("personality win shares:")
    for name, w in wins.most_common():
        share = w / total
        print(f"  {name:<12} {share:.1%}")
        assert share < 0.55, f"{name} dominates ({share:.0%}) — rebalance"
    print("PASS balance")


def test_stats_matter():
    """A clearly stronger agent should win most, not all, battles."""
    strong_wins = 0
    n = 200
    for seed in range(n):
        log = simulate(
            make(1, Personality.AGGRESSIVE, atk=90, dfs=80, spd=85, intel=85),
            make(2, Personality.AGGRESSIVE, atk=45, dfs=45, spd=45, intel=45),
            seed,
        )
        if log["winner"] == 1:
            strong_wins += 1
    rate = strong_wins / n
    print(f"strong-agent win rate: {rate:.1%}")
    assert rate > 0.75, "stats should matter"
    assert rate < 1.0, "underdogs need a chance"
    print("PASS stats matter")


if __name__ == "__main__":
    test_determinism()
    test_different_seeds_differ()
    test_battle_terminates_with_winner()
    test_personality_balance()
    test_stats_matter()
    print("\nAll engine tests passed.")


# ----------------------------- v2 tests -----------------------------------

def test_abilities_and_tier():
    """Elite agents (tier 3) should beat identical tier-1 agents more often
    than not — abilities are real but not auto-win."""
    elite_wins = 0
    n = 300
    for seed in range(n):
        a = make(1, Personality.DEFENSIVE)
        a.tier = 3
        b = make(2, Personality.DEFENSIVE)
        log = simulate(a, b, seed)
        if log["winner"] == 1:
            elite_wins += 1
    rate = elite_wins / n
    print(f"tier-3 vs tier-1 win rate: {rate:.1%}")
    assert 0.55 < rate < 0.90, "abilities should matter without dominating"
    print("PASS abilities")


def test_memory_in_log_and_reproducible():
    """Memory affects behavior AND is embedded in the log inputs, so a
    replay with the same inputs is identical."""
    a = make(1, Personality.AGGRESSIVE)
    a.memory_vs_opponent = (0, 5)  # keeps losing to this opponent
    b = make(2, Personality.DEFENSIVE)
    log1 = simulate(a, b, 123)
    assert log1["inputs"]["agent_a"]["memory_vs_opponent"] == [0, 5]

    a2 = make(1, Personality.AGGRESSIVE)
    a2.memory_vs_opponent = (0, 5)
    b2 = make(2, Personality.DEFENSIVE)
    log2 = simulate(a2, b2, 123)
    c1 = json.dumps(log1, sort_keys=True)
    c2 = json.dumps(log2, sort_keys=True)
    assert c1 == c2
    print("PASS memory reproducibility")


def test_tournament_engine():
    from app.engine.tournament import bracket_hash, run_tournament

    fighters = {
        i: make(
            i,
            [Personality.AGGRESSIVE, Personality.DEFENSIVE,
             Personality.TACTICAL][i % 3],
            atk=50 + i * 3, dfs=50 + (i * 7) % 30, spd=50 + (i * 5) % 35,
            intel=50 + (i * 11) % 40,
        )
        for i in range(1, 11)  # 10 entrants — odd bracket with byes
    }
    rec1 = run_tournament(999, {k: v for k, v in fighters.items()})
    # rebuild fresh fighters (run_tournament deep-copies, but be strict)
    fighters2 = {
        i: make(
            i,
            [Personality.AGGRESSIVE, Personality.DEFENSIVE,
             Personality.TACTICAL][i % 3],
            atk=50 + i * 3, dfs=50 + (i * 7) % 30, spd=50 + (i * 5) % 35,
            intel=50 + (i * 11) % 40,
        )
        for i in range(1, 11)
    }
    rec2 = run_tournament(999, fighters2)
    assert bracket_hash(rec1) == bracket_hash(rec2), "bracket must be deterministic"

    podium = rec1["podium"]
    assert len({podium["first"], podium["second"], podium["third"]}) == 3
    assert all(p in fighters for p in podium.values())
    total_matches = sum(len(r["matches"]) for r in rec1["rounds"])
    assert total_matches == 9, f"10 entrants => 9 matches, got {total_matches}"
    print(f"PASS tournament: podium {podium}, {total_matches} matches")
