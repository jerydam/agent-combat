"""Achievements & market catalog.

Achievements are evaluated from data we already track (agents cache,
battles, solo games, league fixtures). Each grants points once. Points are
wallet-level currency, spendable in the market alongside BOT purchases.

Item kinds:
- skin:  cosmetic avatar (equipped per agent, off-chain)
- boost: permanent on-chain stat points (server calls AgentNFT.boostStats)
- power: equippable combat perk applied by the real-time engine
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (AgentCache, Battle, CombatMatchRecord, Fixture,
                      LeagueRecord, SoloGame)


# ------------------------------------------------------------ achievements

@dataclass(frozen=True)
class AchievementDef:
    id: str
    name: str
    desc: str
    points: int
    # Progress model: earned once `current >= target`. `floor` is where
    # the bar starts filling — ELO begins at 1000, so without it "reach
    # 1100" would render as 91% complete for a player who has never
    # fought.
    target: int = 1
    floor: int = 0
    #: how the current value reads in the UI, e.g. "3 / 10 wins"
    unit: str = ""


ACHIEVEMENTS: list[AchievementDef] = [
    AchievementDef("first_agent", "Genesis", "Mint your first agent", 50, 1, unit="agents"),
    AchievementDef("full_roster", "Full Squad", "Own 5 agents", 150, 5, unit="agents"),
    AchievementDef("first_win", "First Blood", "Win your first battle", 50, 1, unit="wins"),
    AchievementDef("win_10", "Contender", "Win 10 battles", 100, 10, unit="wins"),
    AchievementDef("win_25", "Veteran", "Win 25 battles (Tier 2 evolution)", 200, 25, unit="wins"),
    AchievementDef("win_60", "Elite", "Win 60 battles (Tier 3 evolution)", 400, 60, unit="wins"),
    AchievementDef("level_5", "Grinder", "Reach level 5 on any agent", 100, 5, 1, unit="level"),
    AchievementDef("elo_1100", "Climber", "Reach 1100 ELO", 100, 1100, 1000, unit="ELO"),
    AchievementDef("elo_1300", "Apex", "Reach 1300 ELO", 300, 1300, 1000, unit="ELO"),
    AchievementDef("bot_slayer", "Bot Slayer", "Beat a house bot", 50, 1, unit="wins"),
    AchievementDef("bot_slayer_10", "House Breaker", "Beat house bots 10 times", 150, 10, unit="wins"),
    AchievementDef("league_player", "Leaguer", "Play 5 league fixtures", 100, 5, unit="fixtures"),
    AchievementDef("league_podium", "Podium", "Finish top 3 in a league", 250, 1, unit="podiums"),
    AchievementDef("staked_win", "High Roller", "Win a staked duel", 150, 1, unit="wins"),
]

ACHIEVEMENT_BY_ID = {a.id: a for a in ACHIEVEMENTS}


async def evaluate_progress(db: AsyncSession, wallet: str) -> dict[str, int]:
    """Current value of every achievement's tracked metric for this wallet.

    Returns raw progress (3 wins, 1240 ELO, …) rather than a yes/no, so
    the UI can show how far along the player is instead of a binary
    locked/unlocked. `evaluate()` derives the earned set from this.
    """
    wallet = wallet.lower()

    agents = (
        (await db.execute(select(AgentCache).where(AgentCache.owner == wallet)))
        .scalars().all()
    )
    ids = [a.token_id for a in agents]

    combat_wins = (
        await db.execute(
            select(func.count()).select_from(CombatMatchRecord).where(
                CombatMatchRecord.wallet == wallet,
                CombatMatchRecord.won.is_(True),
                CombatMatchRecord.agent_id.is_(None),  # agent wins counted below
            )
        )
    ).scalar() or 0
    total_wins = sum(a.wins for a in agents) + combat_wins

    solo_wins = 0
    played = 0
    won_duels = 0
    podiums = 0
    if ids:
        solo_wins = (
            await db.execute(
                select(func.count()).select_from(SoloGame).where(
                    SoloGame.agent_id.in_(ids),
                    SoloGame.player_won.is_(True),
                    SoloGame.status == "resolved",
                )
            )
        ).scalar() or 0

        # NOTE: these three used to sit in the `else` branch of `if ids:`,
        # i.e. they only ran for wallets owning NO agents — and then
        # queried `.in_([])`. That made Leaguer and High Roller literally
        # unobtainable for every player who could actually earn them.
        played = (
            await db.execute(
                select(func.count()).select_from(Fixture).where(
                    Fixture.initiator.in_(ids), Fixture.status == "played"
                )
            )
        ).scalar() or 0

        # staked duel win: any resolved battle won by one of our agents
        won_duels = (
            await db.execute(
                select(func.count()).select_from(Battle).where(
                    Battle.winner_agent.in_(ids), Battle.status == "resolved"
                )
            )
        ).scalar() or 0

        # Podium was listed in ACHIEVEMENTS but never computed anywhere,
        # so it could never be earned. Count resolved leagues where one of
        # our agents placed top 3.
        leagues = (
            await db.execute(
                select(LeagueRecord).where(LeagueRecord.status == "resolved")
            )
        ).scalars().all()
        mine = set(ids)
        for lg in leagues:
            top3 = [row.get("agent") for row in (lg.standings or [])[:3]]
            if mine.intersection(t for t in top3 if t is not None):
                podiums += 1

    bot_wins = solo_wins + combat_wins
    best_level = max((a.level for a in agents), default=0)
    best_elo = max((a.ranking_points for a in agents), default=0)

    return {
        "first_agent": len(agents),
        "full_roster": len(agents),
        "first_win": total_wins,
        "win_10": total_wins,
        "win_25": total_wins,
        "win_60": total_wins,
        "level_5": best_level,
        "elo_1100": best_elo,
        "elo_1300": best_elo,
        "bot_slayer": bot_wins,
        "bot_slayer_10": bot_wins,
        "league_player": played,
        "league_podium": podiums,
        "staked_win": won_duels,
    }


async def evaluate(db: AsyncSession, wallet: str) -> set[str]:
    """Return the ids of every achievement this wallet currently satisfies."""
    progress = await evaluate_progress(db, wallet)
    return {
        a.id for a in ACHIEVEMENTS
        if progress.get(a.id, 0) >= a.target
    }


# ----------------------------------------------------------------- market

@dataclass(frozen=True)
class ItemDef:
    id: str
    kind: str  # skin | boost | power
    name: str
    desc: str
    point_price: int  # 0 = not redeemable with points
    # boost payload (per-stat, <=10 each per contract cap)
    boost: tuple[int, int, int, int] | None = None  # atk, def, spd, int
    # power payload — modifiers the combat engine understands
    power: dict | None = None
    # combat payload for SKINS — the same modifier vocabulary as `power`,
    # applied from the equipped avatar rather than the equipped perk. An
    # avatar with no entry here is purely cosmetic and changes nothing.
    combat: dict | None = None


# --------------------------------------------------- avatar combat tiers
#
# Avatars are no longer only cosmetic: what you paid for one is what it
# does in the ring. The budget below grows with point_price, so a more
# expensive avatar is a measurably better fighter, while each one keeps a
# distinct identity (a tank is not just "a striker with bigger numbers").
#
# The modifier vocabulary, all optional, all neutral at their defaults:
#   power_mult         hit power        — damage you DEAL        (1.0)
#   damage_taken_mult  defence rate     — damage you RECEIVE     (1.0)
#   windup_mult        attack speed     — <1 is faster           (1.0)
#   crit_bonus         flat crit chance                          (0.0)
#   block_bonus        extra block absorption                    (0.0)
#   parry_bonus_ms     wider parry window                        (0)
#   regen_mult         stamina regen                             (1.0)
#   hp_bonus           flat extra max HP                         (0)
#   super_gain_mult    how fast the special meter charges        (1.0)
#
# Deliberate balance rule: nothing here touches the parry window enough
# to make timing irrelevant, and the strongest avatars pay for their
# damage somewhere else (Berserker takes more, Titan swings slower). Skill
# still beats spend — money buys an edge, not an auto-win.
#
# These are not vibes. Every set below was tuned against 1400 simulated
# fights per avatar (bot vs bot, each matchup played from BOTH corners so
# turn order cancels out and a bare mirror match sits at exactly 50.0%).
# Measured win rate vs an opponent with no avatar equipped:
#
#   Common     600- 800   50-52%   (+0 .. +2)
#   Uncommon  1000-1200   51-53%   (+1 .. +3)
#   Rare      1500-2000   52-58%   (+2 .. +8)
#   Epic      2500-3500   55-61%   (+5 .. +11)
#   Legendary      4000      63%   (+13)
#
# So the best avatar in the game turns a coin flip into roughly 2:1 — it
# is felt, and it is worth paying for, but a better player on a Ronin
# still beats a worse player on a Gold Ranger. If you retune anything
# here, re-run the harness before shipping; the defensive modifiers
# (damage_taken_mult / hp_bonus / block_bonus) compound over a 90s fight
# and are far stronger per point than they look.

def _tier_for(price: int) -> str:
    if price < 900:
        return "Common"
    if price < 1300:
        return "Uncommon"
    if price < 2100:
        return "Rare"
    if price < 3600:
        return "Epic"
    return "Legendary"


CATALOG: list[ItemDef] = [
    # ---- skins (human-form avatars; asset = /avatars/{id}.svg) ----
    # COMMON — a nudge, not an edge (~4% total budget)
    ItemDef("av_ronin", "skin", "Ronin", "Wandering blade in crimson", 600,
            combat={"power_mult": 1.022, "crit_bonus": 0.006}),
    ItemDef("av_guardian", "skin", "Guardian", "Tower-shield sentinel", 600,
            combat={"damage_taken_mult": 0.992, "block_bonus": 0.010}),
    ItemDef("av_striker", "skin", "Striker", "Bare-knuckle brawler", 600,
            combat={"windup_mult": 0.982, "power_mult": 1.015}),
    ItemDef("av_mystic", "skin", "Mystic", "Mind over muscle", 800,
            combat={"regen_mult": 1.040, "crit_bonus": 0.010, "power_mult": 1.008}),
    ItemDef("av_captain", "skin", "Captain", "Decorated arena veteran", 800,
            combat={"hp_bonus": 3, "power_mult": 1.012}),

    # UNCOMMON — one clear strength each (~7%)
    ItemDef("av_shadow", "skin", "Shadow", "Seen only when striking", 1000,
            combat={"windup_mult": 0.972, "crit_bonus": 0.016, "power_mult": 1.012}),
    ItemDef("av_valkyrie", "skin", "Valkyrie", "Spear of the north", 1000,
            combat={"power_mult": 1.022, "hp_bonus": 3}),
    ItemDef("av_monk", "skin", "Monk", "A hundred parries a day", 1000,
            combat={"parry_bonus_ms": 32, "block_bonus": 0.028, "hp_bonus": 2}),
    ItemDef("av_cyber", "skin", "Cyber Duelist", "Neon augmented fighter", 1200,
            combat={"crit_bonus": 0.018, "super_gain_mult": 1.08, "power_mult": 1.012}),

    # ---- new additions pack (mid-high tier) ----
    # RARE — a real archetype, with real trade-offs (~11%)
    ItemDef("av_phantom",   "skin", "Phantom",   "Purple void ghost. Strikes from the abyss.",             1500,
            combat={"windup_mult": 0.965, "crit_bonus": 0.018, "super_gain_mult": 1.06,
                    "power_mult": 1.010}),
    ItemDef("av_berserker", "skin", "Berserker", "Blazing orange rage fighter. High-ATK playstyle.",       1500,
            # glass cannon: hits hardest in its tier, but takes 3% more
            combat={"power_mult": 1.040, "damage_taken_mult": 1.018, "super_gain_mult": 1.08}),
    ItemDef("av_specter",   "skin", "Specter",   "Neon-green matrix hacker. High-INT tactical mind.",      1800,
            combat={"crit_bonus": 0.024, "regen_mult": 1.060, "parry_bonus_ms": 24,
                    "power_mult": 1.015}),
    ItemDef("av_tempest",   "skin", "Tempest",   "Cyan lightning elemental. Built for pure speed.",        1800,
            combat={"windup_mult": 0.950, "regen_mult": 1.050, "crit_bonus": 0.008}),
    ItemDef("av_ironclad",  "skin", "Ironclad",  "Silver/gunmetal tank. DEF-heavy and immovable.",         2000,
            # pays for its armour in swing speed
            combat={"damage_taken_mult": 0.990, "block_bonus": 0.022, "hp_bonus": 4, "windup_mult": 1.015}),
    ItemDef("av_oracle",    "skin", "Oracle",    "Purple psychic seer. Sees your next move already.",      2000,
            combat={"parry_bonus_ms": 40, "crit_bonus": 0.022, "super_gain_mult": 1.10,
                    "power_mult": 1.015}),
    ItemDef("av_warlord",   "skin", "Warlord",   "Gold-trimmed armored commander. Prestige tournament feel.", 2000,
            combat={"power_mult": 1.030, "hp_bonus": 4, "block_bonus": 0.020}),
    ItemDef("av_champion", "skin", "Champion", "Golden crown of the arena", 2000,
            combat={"power_mult": 1.028, "damage_taken_mult": 0.985, "hp_bonus": 4}),

    # EPIC — tournament-grade (~15%)
    ItemDef("av_ranger_red",  "skin", "Red Ranger",  "Bold sentai front-liner. Aggressive and fearless.",         2500,
            combat={"power_mult": 1.050, "windup_mult": 0.970, "crit_bonus": 0.020}),
    ItemDef("av_ranger_blue", "skin", "Blue Ranger",  "Cool-headed sentai tactician. Calm under pressure.",        2500,
            combat={"damage_taken_mult": 0.972, "parry_bonus_ms": 38, "regen_mult": 1.060,
                    "hp_bonus": 6}),
    ItemDef("av_blaze",       "skin", "Blaze",        "Red-hot flame hero. Burns brighter than the rest.",         3000,
            combat={"power_mult": 1.048, "crit_bonus": 0.026, "super_gain_mult": 1.08}),
    ItemDef("av_volt",        "skin", "Volt",         "Blue/yellow electric speedster. Lightning reflexes.",       3000,
            combat={"windup_mult": 0.945, "crit_bonus": 0.024, "regen_mult": 1.050,
                    "power_mult": 1.015}),
    ItemDef("av_nova",        "skin", "Nova",         "Cosmic energy warrior. Tactical and unstoppable.",          3500,
            # the super-meter specialist: charges its special fastest
            combat={"crit_bonus": 0.042, "super_gain_mult": 1.25, "parry_bonus_ms": 30,
                    "power_mult": 1.030}),
    ItemDef("av_titan",       "skin", "Titan",        "Hulking green tank. Immovable. Unbreakable.",               3500,
            combat={"damage_taken_mult": 0.982, "hp_bonus": 6, "block_bonus": 0.030, "windup_mult": 1.020}),

    # LEGENDARY — best-in-slot everywhere, priced accordingly (~20%)
    ItemDef("av_ranger_gold", "skin", "Gold Ranger",  "Elite prestige variant. Reserved for tournament legends.",  4000,
            combat={"power_mult": 1.048, "damage_taken_mult": 0.975, "windup_mult": 0.972,
                    "crit_bonus": 0.026, "super_gain_mult": 1.12, "hp_bonus": 6}),

    # ---- boosts (on-chain, permanent) ----
    ItemDef("boost_str", "boost", "Strength Serum", "+5 ATK on-chain", 800, boost=(5, 0, 0, 0)),
    ItemDef("boost_grit", "boost", "Grit Serum", "+5 DEF on-chain", 800, boost=(0, 5, 0, 0)),
    ItemDef("boost_agility", "boost", "Agility Serum", "+5 SPD on-chain", 800, boost=(0, 0, 5, 0)),
    ItemDef("boost_mind", "boost", "Mind Serum", "+5 INT on-chain", 800, boost=(0, 0, 0, 5)),
    ItemDef("boost_omni", "boost", "Omni Serum", "+3 to every stat on-chain", 2000, boost=(3, 3, 3, 3)),
    # ---- powers (equippable combat perks, one active per agent) ----
    ItemDef("pw_second_wind", "power", "Second Wind", "+20% stamina regen", 1000,
            power={"regen_mult": 1.2}),
    ItemDef("pw_iron_guard", "power", "Iron Guard", "Blocks absorb 6% more", 1000,
            power={"block_bonus": 0.06}),
    ItemDef("pw_focus_core", "power", "Focus Core", "Parry window +40ms", 1400,
            power={"parry_bonus_ms": 40}),
]

ITEM_BY_ID = {i.id: i for i in CATALOG}

AVATAR_TIERS = {i.id: _tier_for(i.point_price) for i in CATALOG if i.kind == "skin"}


def avatar_mods(skin_id: str | None) -> dict:
    """Combat modifiers granted by an equipped avatar (empty if none)."""
    if not skin_id:
        return {}
    item = ITEM_BY_ID.get(skin_id)
    if item is None or item.kind != "skin" or not item.combat:
        return {}
    return dict(item.combat)


def merge_mods(*sources: dict | None) -> dict:
    """Combine avatar + power modifiers into one dict for the engine.

    Multiplicative keys compose (two +10% damage sources give 1.21x, not
    1.20x) and additive keys sum. Done explicitly because a plain
    dict-update would silently let whichever source was applied last
    erase the other — equipping a perk would cancel your avatar.
    """
    MULTIPLICATIVE = {
        "power_mult", "damage_taken_mult", "windup_mult",
        "regen_mult", "super_gain_mult",
    }
    ADDITIVE = {"crit_bonus", "block_bonus", "parry_bonus_ms", "hp_bonus"}

    out: dict = {}
    for src in sources:
        if not src:
            continue
        for k, v in src.items():
            if k in MULTIPLICATIVE:
                out[k] = out.get(k, 1.0) * float(v)
            elif k in ADDITIVE:
                out[k] = out.get(k, 0) + v
            else:
                out[k] = v
    return out


def avatar_power_rating(item: ItemDef) -> int:
    """0-100 summary of how much an avatar helps, for display only.

    Purely a UI aid so a buyer can compare two avatars at a glance
    without decoding six modifiers; the engine never reads this.
    """
    c = item.combat or {}
    score = (
        (c.get("power_mult", 1.0) - 1.0) * 220
        + (1.0 - c.get("damage_taken_mult", 1.0)) * 220
        + (1.0 - c.get("windup_mult", 1.0)) * 180
        + c.get("crit_bonus", 0.0) * 260
        + c.get("block_bonus", 0.0) * 130
        + c.get("parry_bonus_ms", 0) * 0.14
        + (c.get("regen_mult", 1.0) - 1.0) * 90
        + (c.get("super_gain_mult", 1.0) - 1.0) * 110
        + c.get("hp_bonus", 0) * 0.5
    )
    return max(0, min(100, round(score)))


# --------------------------------------------------------------- pricing
# Exchange rule: 1000 points == 1 USD. Every item is therefore worth
# point_price/1000 USD, payable either in points or in BOT at the current
# BOT/USD price (settings.bot_usd_price). Minimum item price is 0.6 USD.

POINTS_PER_USD = 1000
MIN_ITEM_USD = 0.6

assert all(i.point_price >= MIN_ITEM_USD * POINTS_PER_USD for i in CATALOG), \
    "catalog violates the 0.6 USD minimum item price"


def usd_price(item: ItemDef) -> float:
    return item.point_price / POINTS_PER_USD


def bot_price_wei(item: ItemDef, bot_usd: float) -> int:
    """Price in BOT wei for the same USD value the points represent."""
    if bot_usd <= 0:
        return 0
    return int(round(usd_price(item) / bot_usd * 10**18))

