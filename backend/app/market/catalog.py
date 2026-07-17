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

from ..models import AgentCache, Battle, Fixture, SoloGame


# ------------------------------------------------------------ achievements

@dataclass(frozen=True)
class AchievementDef:
    id: str
    name: str
    desc: str
    points: int


ACHIEVEMENTS: list[AchievementDef] = [
    AchievementDef("first_agent", "Genesis", "Mint your first agent", 50),
    AchievementDef("full_roster", "Full Squad", "Own 5 agents", 150),
    AchievementDef("first_win", "First Blood", "Win your first battle", 50),
    AchievementDef("win_10", "Contender", "Win 10 battles", 100),
    AchievementDef("win_25", "Veteran", "Win 25 battles (Tier 2 evolution)", 200),
    AchievementDef("win_60", "Elite", "Win 60 battles (Tier 3 evolution)", 400),
    AchievementDef("level_5", "Grinder", "Reach level 5 on any agent", 100),
    AchievementDef("elo_1100", "Climber", "Reach 1100 ELO", 100),
    AchievementDef("elo_1300", "Apex", "Reach 1300 ELO", 300),
    AchievementDef("bot_slayer", "Bot Slayer", "Beat a house bot", 50),
    AchievementDef("bot_slayer_10", "House Breaker", "Beat house bots 10 times", 150),
    AchievementDef("league_player", "Leaguer", "Play 5 league fixtures", 100),
    AchievementDef("league_podium", "Podium", "Finish top 3 in a league", 250),
    AchievementDef("staked_win", "High Roller", "Win a staked duel", 150),
]

ACHIEVEMENT_BY_ID = {a.id: a for a in ACHIEVEMENTS}


async def evaluate(db: AsyncSession, wallet: str) -> set[str]:
    """Return the ids of every achievement this wallet currently satisfies."""
    wallet = wallet.lower()
    earned: set[str] = set()

    agents = (
        (await db.execute(select(AgentCache).where(AgentCache.owner == wallet)))
        .scalars().all()
    )
    if agents:
        earned.add("first_agent")
    if len(agents) >= 5:
        earned.add("full_roster")

    total_wins = sum(a.wins for a in agents)
    if total_wins >= 1:
        earned.add("first_win")
    if total_wins >= 10:
        earned.add("win_10")
    if total_wins >= 25:
        earned.add("win_25")
    if total_wins >= 60:
        earned.add("win_60")
    if any(a.level >= 5 for a in agents):
        earned.add("level_5")
    if any(a.ranking_points >= 1100 for a in agents):
        earned.add("elo_1100")
    if any(a.ranking_points >= 1300 for a in agents):
        earned.add("elo_1300")

    ids = [a.token_id for a in agents]
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
        if solo_wins >= 1:
            earned.add("bot_slayer")
        if solo_wins >= 10:
            earned.add("bot_slayer_10")

        played = (
            await db.execute(
                select(func.count()).select_from(Fixture).where(
                    Fixture.initiator.in_(ids), Fixture.status == "played"
                )
            )
        ).scalar() or 0
        if played >= 5:
            earned.add("league_player")

        # staked duel win: any resolved battle won by our agent with stake — we
        # don't mirror stake in Battle, so approximate via battles won (kept
        # conservative: requires the battles table which only real duels hit)
        won_duels = (
            await db.execute(
                select(func.count()).select_from(Battle).where(
                    Battle.winner_agent.in_(ids), Battle.status == "resolved"
                )
            )
        ).scalar() or 0
        if won_duels >= 1:
            earned.add("staked_win")

    return earned


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


CATALOG: list[ItemDef] = [
    # ---- skins (human-form avatars; asset = /avatars/{id}.svg) ----
    ItemDef("av_ronin", "skin", "Ronin", "Wandering blade in crimson", 100),
    ItemDef("av_guardian", "skin", "Guardian", "Tower-shield sentinel", 100),
    ItemDef("av_striker", "skin", "Striker", "Bare-knuckle brawler", 100),
    ItemDef("av_mystic", "skin", "Mystic", "Mind over muscle", 150),
    ItemDef("av_captain", "skin", "Captain", "Decorated arena veteran", 150),
    ItemDef("av_shadow", "skin", "Shadow", "Seen only when striking", 200),
    ItemDef("av_valkyrie", "skin", "Valkyrie", "Spear of the north", 200),
    ItemDef("av_monk", "skin", "Monk", "A hundred parries a day", 200),
    ItemDef("av_cyber", "skin", "Cyber Duelist", "Neon augmented fighter", 300),
    ItemDef("av_champion", "skin", "Champion", "Golden crown of the arena", 500),
    # ---- new additions pack (mid-high tier) ----
    ItemDef("av_phantom",   "skin", "Phantom",   "Purple void ghost. Strikes from the abyss.",             1500),
    ItemDef("av_berserker", "skin", "Berserker", "Blazing orange rage fighter. High-ATK playstyle.",       1500),
    ItemDef("av_warlord",   "skin", "Warlord",   "Gold-trimmed armored commander. Prestige tournament feel.", 2000),
    ItemDef("av_specter",   "skin", "Specter",   "Neon-green matrix hacker. High-INT tactical mind.",      1800),
    ItemDef("av_tempest",   "skin", "Tempest",   "Cyan lightning elemental. Built for pure speed.",        1800),
    ItemDef("av_ironclad",  "skin", "Ironclad",  "Silver/gunmetal tank. DEF-heavy and immovable.",         2000),
    ItemDef("av_oracle",    "skin", "Oracle",    "Purple psychic seer. Sees your next move already.",      2000),
    ItemDef("av_ranger_red",  "skin", "Red Ranger",  "Bold sentai front-liner. Aggressive and fearless.",         2500),
    ItemDef("av_ranger_blue", "skin", "Blue Ranger",  "Cool-headed sentai tactician. Calm under pressure.",        2500),
    ItemDef("av_ranger_gold", "skin", "Gold Ranger",  "Elite prestige variant. Reserved for tournament legends.",  4000),
    ItemDef("av_blaze",       "skin", "Blaze",        "Red-hot flame hero. Burns brighter than the rest.",         3000),
    ItemDef("av_nova",        "skin", "Nova",         "Cosmic energy warrior. Tactical and unstoppable.",          3500),
    ItemDef("av_volt",        "skin", "Volt",         "Blue/yellow electric speedster. Lightning reflexes.",       3000),
    ItemDef("av_titan",       "skin", "Titan",        "Hulking green tank. Immovable. Unbreakable.",               3500),

    # ---- boosts (on-chain, permanent) ----
    ItemDef("boost_str", "boost", "Strength Serum", "+5 ATK on-chain", 250, boost=(5, 0, 0, 0)),
    ItemDef("boost_grit", "boost", "Grit Serum", "+5 DEF on-chain", 250, boost=(0, 5, 0, 0)),
    ItemDef("boost_agility", "boost", "Agility Serum", "+5 SPD on-chain", 250, boost=(0, 0, 5, 0)),
    ItemDef("boost_mind", "boost", "Mind Serum", "+5 INT on-chain", 250, boost=(0, 0, 0, 5)),
    ItemDef("boost_omni", "boost", "Omni Serum", "+3 to every stat on-chain", 600, boost=(3, 3, 3, 3)),
    # ---- powers (equippable combat perks, one active per agent) ----
    ItemDef("pw_second_wind", "power", "Second Wind", "+20% stamina regen", 300,
            power={"regen_mult": 1.2}),
    ItemDef("pw_iron_guard", "power", "Iron Guard", "Blocks absorb 6% more", 300,
            power={"block_bonus": 0.06}),
    ItemDef("pw_focus_core", "power", "Focus Core", "Parry window +40ms", 400,
            power={"parry_bonus_ms": 40}),
]

ITEM_BY_ID = {i.id: i for i in CATALOG}
