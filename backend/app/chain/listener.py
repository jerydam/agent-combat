"""The game loop, v2.

Watches BOT Chain for:
- ChallengeAccepted / QuickMatchStarted -> resolve the battle:
  fetch on-chain stats (incl. evolution tier), load head-to-head memory,
  run the deterministic simulation from the on-chain seed, sign the result
  (EIP-712), submit, persist the full log, update ELO.
- AgentMinted -> mirror into the agents cache.
- TournamentStarted -> derive the bracket from the on-chain seed, simulate
  every match, submit the signed podium, persist the full bracket record.

BOT Chain: 0.75s blocks, ~0.9s finality — battles resolve in seconds.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from eth_account import Account
from web3 import Web3

from ..config import get_settings
from ..database import SessionLocal
from ..engine.agent_engine import FighterState, Personality
from ..engine.memory import head_to_head
from ..engine.league import (compute_standings, generate_fixtures,
                             standings_hash)
from ..engine.simulator import simulate
from ..engine.tournament import bracket_hash, run_tournament
from ..models import (AgentCache, Battle, Fixture, InventoryItem,
                      LeagueRecord, SoloGame, TournamentRecord)
from .client import get_contracts, get_w3
from .signer import moves_hash

log = logging.getLogger("arena.listener")

K_FACTOR = 32


def _fighter_from_chain(nft, token_id: int) -> FighterState:
    (stats, name) = nft.functions.getAgent(token_id).call()
    (atk, dfs, spd, intel, level, _w, _l, _xp, _last, pers, tier) = stats
    return FighterState(
        token_id=token_id,
        name=name,
        personality=Personality(pers),
        attack=atk,
        defense=dfs,
        speed=spd,
        intelligence=intel,
        level=level,
        tier=tier,
    )


def _elo(winner_pts: int, loser_pts: int) -> tuple[int, int]:
    expected_w = 1 / (1 + 10 ** ((loser_pts - winner_pts) / 400))
    delta = round(K_FACTOR * (1 - expected_w))
    return winner_pts + delta, loser_pts - delta


def _send_tx(w3: Web3, fn) -> str:
    s = get_settings()
    acct = Account.from_key(s.game_server_private_key)
    tx = fn.build_transaction(
        {
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "chainId": s.chain_id,
        }
    )
    signed = acct.sign_transaction(tx)
    return w3.eth.send_raw_transaction(signed.raw_transaction).hex()


async def _sync_agent_record(db, token_id: int, won: bool, log_: dict, opp_pts: int):
    agent = await db.get(AgentCache, token_id)
    if agent is None:
        return 1000
    return agent


async def _apply_result(battle_log: dict, winner_id: int, loser_id: int) -> None:
    async with SessionLocal() as db:
        w = await db.get(AgentCache, winner_id)
        l = await db.get(AgentCache, loser_id)
        if w and l:
            w.ranking_points, l.ranking_points = _elo(
                w.ranking_points, l.ranking_points
            )
            w.wins += 1
            l.losses += 1
            await db.commit()


async def resolve_battle(
    w3, nft, arena, battle_id: int, agent_a_id: int, agent_b_id: int, seed: int
) -> None:
    async with SessionLocal() as db:
        existing = await db.get(Battle, battle_id)
        if existing and existing.status == "resolved":
            return
        # Agent memory: prior head-to-head — embedded in the log's inputs
        mem_a = await head_to_head(db, agent_a_id, agent_b_id)
        mem_b = (mem_a[1], mem_a[0])

    log.info("Resolving battle %s: %s vs %s", battle_id, agent_a_id, agent_b_id)

    fighter_a = _fighter_from_chain(nft, agent_a_id)
    fighter_b = _fighter_from_chain(nft, agent_b_id)
    fighter_a.memory_vs_opponent = mem_a
    fighter_b.memory_vs_opponent = mem_b

    battle_log = simulate(fighter_a, fighter_b, seed)
    m_hash = moves_hash(battle_log)
    winner = battle_log["winner"]
    loser = agent_b_id if winner == agent_a_id else agent_a_id

    tx_hash = _send_tx(
        w3, arena.functions.submitResult(battle_id, winner, m_hash)
    )

    async with SessionLocal() as db:
        battle = await db.get(Battle, battle_id) or Battle(
            battle_id=battle_id, agent_a=agent_a_id, agent_b=agent_b_id
        )
        battle.seed = str(seed)
        battle.status = "resolved"
        battle.winner_agent = winner
        battle.moves = battle_log
        battle.moves_hash = m_hash.hex()
        battle.tx_hash = tx_hash
        battle.resolved_at = datetime.now(timezone.utc)
        db.add(battle)
        await db.commit()

    await _apply_result(battle_log, winner, loser)
    log.info("Battle %s: winner #%s (tx %s)", battle_id, winner, tx_hash)


async def resolve_tournament(w3, nft, tournament, tid: int, bracket_seed: int):
    async with SessionLocal() as db:
        existing = await db.get(TournamentRecord, tid)
        if existing and existing.status == "resolved":
            return

    entrant_ids = tournament.functions.getEntrants(tid).call()
    log.info("Resolving tournament %s: %d entrants", tid, len(entrant_ids))

    fighters = {aid: _fighter_from_chain(nft, aid) for aid in entrant_ids}
    record = run_tournament(bracket_seed, fighters)
    b_hash = bracket_hash(record)
    podium = record["podium"]

    tx_hash = _send_tx(
        w3,
        tournament.functions.submitPodium(
            tid,
            podium["first"],
            podium["second"],
            podium["third"],
            b_hash,
        ),
    )

    async with SessionLocal() as db:
        rec = await db.get(TournamentRecord, tid) or TournamentRecord(
            tournament_id=tid
        )
        rec.status = "resolved"
        rec.bracket_seed = str(bracket_seed)
        rec.entrants = list(entrant_ids)
        rec.bracket = record
        rec.bracket_hash = b_hash.hex()
        rec.podium = podium
        rec.tx_hash = tx_hash
        rec.resolved_at = datetime.now(timezone.utc)
        db.add(rec)
        await db.commit()

    log.info("Tournament %s podium: %s (tx %s)", tid, podium, tx_hash)


async def resolve_solo(w3, nft, solo, event) -> None:
    """Player vs bot: same trust loop as duels, house pays via SoloArena."""
    game_id = event["args"]["gameId"]
    agent_id = event["args"]["agentId"]
    bot_id = event["args"]["botId"]
    seed = event["args"]["seed"]

    async with SessionLocal() as db:
        existing = await db.get(SoloGame, game_id)
        if existing and existing.status == "resolved":
            return
        mem = await head_to_head(db, agent_id, bot_id)

    fighter = _fighter_from_chain(nft, agent_id)
    bot = _fighter_from_chain(nft, bot_id)
    fighter.memory_vs_opponent = mem
    bot.memory_vs_opponent = (mem[1], mem[0])

    battle_log = simulate(fighter, bot, seed)
    m_hash = moves_hash(battle_log)
    player_won = battle_log["winner"] == agent_id

    tx_hash = _send_tx(
        w3, solo.functions.submitResult(game_id, player_won, m_hash)
    )

    async with SessionLocal() as db:
        g = await db.get(SoloGame, game_id) or SoloGame(
            game_id=game_id, agent_id=agent_id, bot_id=bot_id
        )
        g.player = event["args"]["player"]
        g.stake_wei = str(event["args"]["stake"])
        g.status = "resolved"
        g.player_won = player_won
        g.moves = battle_log
        g.moves_hash = m_hash.hex()
        g.tx_hash = tx_hash
        db.add(g)
        await db.commit()
    log.info("Solo game %s: player %s (tx %s)",
             game_id, "won" if player_won else "lost", tx_hash)


async def open_league(league_contract, league_id: int, seed: int) -> None:
    """LeagueActivated: mirror the room and generate everyone's fixtures."""
    room = league_contract.functions.rooms(league_id).call()
    entrant_ids = league_contract.functions.getEntrants(league_id).call()

    async with SessionLocal() as db:
        if await db.get(LeagueRecord, league_id):
            return
        db.add(
            LeagueRecord(
                league_id=league_id,
                status="active",
                seed=str(seed),
                start_time=room[3],
                end_time=room[4],
                entrants=list(entrant_ids),
            )
        )
        for f in generate_fixtures(list(entrant_ids)):
            db.add(
                Fixture(
                    league_id=league_id,
                    idx=f["index"],
                    initiator=f["initiator"],
                    opponent=f["opponent"],
                )
            )
        await db.commit()
    log.info("League %s active: %d players, %d fixtures",
             league_id, len(entrant_ids), len(entrant_ids) * (len(entrant_ids) - 1))


async def finalize_ended_leagues(w3, league_contract) -> None:
    """Any active league past its end time: forfeit unplayed fixtures,
    compute the table, submit signed standings, trigger payouts."""
    from sqlalchemy import select

    now = int(datetime.now(timezone.utc).timestamp())
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(LeagueRecord).where(
                    LeagueRecord.status == "active",
                    LeagueRecord.end_time <= now,
                )
            )
        ).scalars().all()
        leagues = [(r.league_id, r.entrants) for r in rows]

    for league_id, entrant_ids in leagues:
        async with SessionLocal() as db:
            fixtures = (
                (await db.execute(
                    select(Fixture).where(Fixture.league_id == league_id)
                )).scalars().all()
            )
            fixture_dicts = []
            for f in fixtures:
                if f.status == "pending":
                    f.status = "forfeit"
                fixture_dicts.append(
                    {
                        "index": f.idx,
                        "initiator": f.initiator,
                        "opponent": f.opponent,
                        "status": f.status,
                        "winner": f.winner,
                        "hp_diff": f.hp_diff,
                        "moves_hash": (
                            moves_hash(f.log).hex() if f.log else ""
                        ),
                    }
                )
            standings = compute_standings(entrant_ids, fixture_dicts)
            record = {
                "league_id": league_id,
                "fixtures": fixture_dicts,
                "standings": standings,
            }
            s_hash = standings_hash(record)
            top3 = [standings[i]["agent"] for i in range(3)]

            tx_hash = _send_tx(
                w3,
                league_contract.functions.submitStandings(
                    league_id, *top3, s_hash
                ),
            )
            rec = await db.get(LeagueRecord, league_id)
            rec.status = "resolved"
            rec.standings = standings
            rec.standings_hash = s_hash.hex()
            rec.tx_hash = tx_hash
            rec.resolved_at = datetime.now(timezone.utc)
            await db.commit()
        log.info("League %s resolved: podium %s (tx %s)", league_id, top3, tx_hash)


async def sync_minted_agents(nft, from_block: int, to_block: int) -> None:
    events = nft.events.AgentMinted().get_logs(
        from_block=from_block, to_block=to_block
    )
    if not events:
        return
    async with SessionLocal() as db:
        for ev in events:
            a = ev["args"]
            if await db.get(AgentCache, a["tokenId"]):
                continue
            db.add(
                AgentCache(
                    token_id=a["tokenId"],
                    owner=a["owner"],
                    name=a["name"],
                    personality=a["personality"],
                    attack=a["attack"],
                    defense=a["defense"],
                    speed=a["speed"],
                    intelligence=a["intelligence"],
                )
            )
        await db.commit()


async def run_listener() -> None:
    s = get_settings()
    if not (s.rpc_url and s.battle_arena_address and s.agent_nft_address):
        log.warning("Chain env not configured — listener disabled")
        return

    w3 = get_w3()
    nft, arena, tournament, league, solo, shop = get_contracts(w3)
    last_block = w3.eth.block_number

    log.info("Listener started at block %s", last_block)
    while True:
        try:
            current = w3.eth.block_number
            if current > last_block:
                frm, to = last_block + 1, current
                await sync_minted_agents(nft, frm, to)

                # Accepted challenges: fetch pairing from getBattle
                for ev in arena.events.ChallengeAccepted().get_logs(
                    from_block=frm, to_block=to
                ):
                    bid = ev["args"]["battleId"]
                    b = arena.functions.getBattle(bid).call()
                    await resolve_battle(
                        w3, nft, arena, bid, b[0], b[1], ev["args"]["seed"]
                    )

                for ev in arena.events.QuickMatchStarted().get_logs(
                    from_block=frm, to_block=to
                ):
                    await resolve_battle(
                        w3,
                        nft,
                        arena,
                        ev["args"]["battleId"],
                        ev["args"]["agentA"],
                        ev["args"]["agentB"],
                        ev["args"]["seed"],
                    )

                if solo is not None:
                    for ev in solo.events.SoloPlayed().get_logs(
                        from_block=frm, to_block=to
                    ):
                        await resolve_solo(w3, nft, solo, ev)

                if league is not None:
                    for ev in league.events.LeagueActivated().get_logs(
                        from_block=frm, to_block=to
                    ):
                        await open_league(
                            league,
                            ev["args"]["leagueId"],
                            ev["args"]["seed"],
                        )
                    await finalize_ended_leagues(w3, league)

                if shop is not None:
                    for ev in shop.events.ItemPurchased().get_logs(
                        from_block=frm, to_block=to
                    ):
                        async with SessionLocal() as db:
                            db.add(InventoryItem(
                                wallet=ev["args"]["buyer"].lower(),
                                item_id=ev["args"]["itemId"],
                                source="bot",
                            ))
                            await db.commit()
                        log.info("Shop purchase granted: %s -> %s",
                                 ev["args"]["itemId"], ev["args"]["buyer"])

                if tournament is not None:
                    for ev in tournament.events.TournamentStarted().get_logs(
                        from_block=frm, to_block=to
                    ):
                        await resolve_tournament(
                            w3,
                            nft,
                            tournament,
                            ev["args"]["tournamentId"],
                            ev["args"]["bracketSeed"],
                        )

                last_block = current
        except Exception:
            log.exception("Listener tick failed; retrying")
        await asyncio.sleep(s.poll_interval_seconds)
