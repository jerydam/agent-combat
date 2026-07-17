"""Combat engine tests: headless bot-vs-bot through the real tick loop,
plus rule checks for the anti-autoclicker mechanics."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.combat.bot_ai import BotController
from app.combat.engine import TUNING, CombatMatch
from app.engine.agent_engine import FighterState, Personality


def stats(tid, pers, power=70, tier=1):
    return FighterState(
        token_id=tid, name=f"F{tid}", personality=Personality(pers),
        attack=power, defense=power, speed=power, intelligence=power,
        level=1, tier=tier,
    )


def run_headless(a, b, seed=1, max_ms=None):
    m = CombatMatch(a, b, seed=seed)
    bots = [BotController(m, 0, seed=seed), BotController(m, 1, seed=seed + 1)]
    limit = max_ms or TUNING["match_duration_ms"] + 1000
    while not m.over and m.t < limit:
        m.tick(50)
        for bot in bots:
            bot.update()
    return m


def test_match_completes_with_winner():
    for seed in range(8):
        m = run_headless(stats(1, 0), stats(2, 1), seed=seed)
        assert m.over and m.winner in (0, 1)
        total_hits = m.f[0].hits_landed + m.f[1].hits_landed
        assert total_hits > 3, "bots should actually fight"
    print("PASS matches complete; bots fight")


def test_autoclicker_loses_to_bot():
    """A both-buttons masher (the autoclicker) vs a mid bot: the masher
    should lose most matches — spam is designed to be bad."""
    masher_wins = 0
    n = 12
    for seed in range(n):
        m = CombatMatch(stats(1, 0), stats(2, 2), seed=seed)
        bot = BotController(m, 1, seed=seed)
        while not m.over and m.t < TUNING["match_duration_ms"] + 1000:
            m.tick(50)
            # the masher: hammer both buttons every tick
            m.input_attack(0, "light")
            m.input_defend(0)
            bot.update()
        if m.winner == 0:
            masher_wins += 1
    rate = masher_wins / n
    print(f"masher win rate vs tactical bot: {rate:.0%}")
    assert rate <= 0.25, "mashing must not be a viable strategy"
    print("PASS autoclicker loses by design")


def test_spam_gets_exhausted_fast():
    m = CombatMatch(stats(1, 0), stats(2, 1), seed=1)
    exhausted_at = None
    while m.t < 10_000:
        m.tick(50)
        m.input_attack(0, "light")
        m.input_defend(0)
        if m.f[0].is_exhausted(m.t) and exhausted_at is None:
            exhausted_at = m.t
            break
    assert exhausted_at is not None and exhausted_at < 8000, exhausted_at
    print(f"PASS spam exhausts in {exhausted_at/1000:.1f}s")


def test_attack_rate_capped():
    """Tapping every tick can't exceed the windup+cooldown cadence."""
    m = CombatMatch(stats(1, 0, power=90), stats(2, 1), seed=1)
    # give infinite stamina to isolate the timing cap
    m.f[0].stats.intelligence = 90
    while m.t < 5000:
        m.f[0].stamina = 100.0
        m.tick(50)
        m.input_attack(0, "light")
    thrown = m.f[0].attacks_thrown
    # speed 90: windup 325ms + cooldown 320ms => ~7.7 attacks in 5s max
    assert thrown <= 9, f"attack rate not capped: {thrown} in 5s"
    print(f"PASS attack rate capped ({thrown} attacks in 5s at speed 90)")


def test_parry_staggers_and_counters():
    a = stats(1, 0, power=70)
    b = stats(2, 1, power=70, tier=2)  # counter ability
    m = CombatMatch(a, b, seed=3)
    m.input_attack(0, "light")
    windup = m.f[0].phase_ends_at
    # defender blocks 100ms before impact => inside the parry window
    while m.t < windup - 100:
        m.tick(50)
    m.input_defend(1)
    while m.t < windup + 100:
        m.tick(50)
    parries = m.f[1].parries
    assert parries == 1, f"expected a parry, got {parries}"
    assert m.f[0].staggered_until > m.t - 200, "attacker should be staggered"
    assert m.f[0].hp < m.f[0].max_hp, "tier-2 counter should deal damage"
    print("PASS parry: stagger + tier-2 counter")


def test_tier_advantage_realtime():
    wins = 0
    n = 10
    for seed in range(n):
        m = run_headless(stats(1, 2, tier=3), stats(2, 2, tier=1), seed=seed)
        if m.winner == 0:
            wins += 1
    print(f"tier-3 bot vs tier-1 bot: {wins}/{n}")
    assert wins >= n * 0.5, "abilities should matter in realtime too"
    print("PASS tier abilities matter")


if __name__ == "__main__":
    test_match_completes_with_winner()
    test_autoclicker_loses_to_bot()
    test_spam_gets_exhausted_fast()
    test_attack_rate_capped()
    test_parry_staggers_and_counters()
    test_tier_advantage_realtime()
    print("\nAll combat tests passed.")
