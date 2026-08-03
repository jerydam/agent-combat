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
from sqlalchemy import select
from web3 import Web3

from ..config import get_settings
from ..database import SessionLocal
from ..engine.agent_engine import FighterState, Personality
from ..engine.memory import head_to_head
from ..engine.league import (compute_standings, generate_fixtures,
                             standings_hash)
from ..engine.simulator import simulate
from ..engine.tournament import bracket_hash, run_tournament
from ..market.catalog import ITEM_BY_ID
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


class TxFailed(RuntimeError):
    """A submitted transaction reverted or never confirmed."""


def _send_tx(w3: Web3, fn, *, wait: bool = True, timeout: int = 90) -> str:
    """Sign, broadcast and (by default) WAIT for the receipt.

    Waiting is not optional bookkeeping — it is the difference between
    "the player was paid" and "we told the player they were paid". A
    broadcast tx can still run out of gas, revert on a state change, or
    never be mined; without the receipt every one of those looks
    identical to success, so the DB gets marked resolved and the payout
    silently never happens.
    """
    s = get_settings()
    if not s.game_server_private_key:
        raise TxFailed("GAME_SERVER_PRIVATE_KEY is not set — cannot submit results")

    acct = Account.from_key(s.game_server_private_key)

    # Fail loudly and specifically on an unfunded signer. Otherwise this
    # surfaces as an opaque "insufficient funds for gas * price + value"
    # from deep inside web3, or worse, as a silent no-op.
    balance = w3.eth.get_balance(acct.address)
    if balance == 0:
        raise TxFailed(
            f"game-server account {acct.address} has ZERO balance on chain "
            f"{w3.eth.chain_id} — it cannot pay gas, so no result can ever be "
            f"submitted and no staked win can ever pay out. Fund this address."
        )

    tx = fn.build_transaction(
        {
            "from": acct.address,
            # "pending", not the default "latest": two fights finishing in
            # the same block would otherwise build on the same nonce and
            # the second tx is rejected as a duplicate/underpriced replacement.
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            # read from the node, not env — a CHAIN_ID typo must not brick
            # every submitResult with an invalid-chain-id revert
            "chainId": w3.eth.chain_id,
        }
    )
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    hex_hash = tx_hash.hex()
    if not hex_hash.startswith("0x"):
        hex_hash = "0x" + hex_hash

    if not wait:
        return hex_hash

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
    if receipt.get("status") != 1:
        raise TxFailed(f"tx {hex_hash} reverted on chain (status 0)")
    return hex_hash


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


async def index_solo(event) -> None:
    """SoloPlayed: index the staked game as pending. The player's live
    combat match resolves it (routers/combat.py); if they never play it,
    sweep_stale_solo() settles it by simulation so the stake never locks."""
    game_id = event["args"]["gameId"]
    async with SessionLocal() as db:
        if await db.get(SoloGame, game_id):
            return
        db.add(SoloGame(
            game_id=game_id,
            agent_id=event["args"]["agentId"],
            bot_id=event["args"]["botId"],
            player=event["args"]["player"].lower(),
            stake_wei=str(event["args"]["stake"]),
            status="pending",
        ))
        await db.commit()
    log.info("Solo game %s indexed (pending live combat)", game_id)


SOLO_PENDING_TTL_S = 15 * 60  # abandoned staked games are only WARNED about

# On-chain SoloArena.Status
_ST_NONE, _ST_PENDING, _ST_RESOLVED, _ST_RECLAIMED = 0, 1, 2, 3


async def retry_unsettled_solo(w3, solo) -> None:
    """Re-submit staked games whose live fight produced a result but whose
    on-chain submitResult did not land.

    This is the missing half of the payout path. A fight can finish
    perfectly — the player watched themselves win — and the settlement tx
    can still fail for reasons that have nothing to do with the game: the
    signer was out of gas, the RPC blipped, the node dropped the tx. Left
    alone, that player's win silently becomes a 1-hour wait for a manual
    reclaim of their own stake, and they never see the 1.8x they earned.

    So the result is persisted as `unsettled` the moment the fight ends
    and retried here until the chain confirms it.
    """
    from sqlalchemy import select

    if solo is None:
        return

    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(SoloGame).where(SoloGame.status == "unsettled")
            )
        ).scalars().all()
        todo = [(g.game_id, g.player_won, g.moves, g.moves_hash) for g in rows]

    for game_id, won, moves, m_hash_hex in todo:
        # The chain is the source of truth. Our tx may have landed even
        # though we never saw the receipt — resubmitting then would just
        # revert GameNotPending and look like a new failure.
        try:
            onchain = solo.functions.getGame(game_id).call()
            status = onchain[4]
        except Exception:
            log.exception("solo %s: getGame failed, will retry next tick", game_id)
            continue

        if status == _ST_RESOLVED:
            async with SessionLocal() as db:
                g = await db.get(SoloGame, game_id)
                if g:
                    g.status = "resolved"
                    g.player_won = bool(onchain[5])
                    await db.commit()
            log.info("solo %s was already resolved on-chain — DB reconciled", game_id)
            continue

        if status == _ST_RECLAIMED:
            async with SessionLocal() as db:
                g = await db.get(SoloGame, game_id)
                if g:
                    g.status = "reclaimed"
                    await db.commit()
            log.warning(
                "solo %s: player reclaimed their stake before we could settle "
                "— their win was never paid out", game_id,
            )
            continue

        if status != _ST_PENDING:
            continue

        try:
            m_hash = bytes.fromhex(m_hash_hex[2:] if m_hash_hex.startswith("0x") else m_hash_hex) \
                if m_hash_hex else moves_hash(moves or {})
            tx_hash = _send_tx(
                w3, solo.functions.submitResult(game_id, bool(won), m_hash)
            )
        except Exception as e:
            log.error("solo %s: settlement retry failed (%s)", game_id, e)
            continue

        async with SessionLocal() as db:
            g = await db.get(SoloGame, game_id)
            if g:
                g.status = "resolved"
                g.tx_hash = tx_hash
                await db.commit()
        log.info("solo %s settled on retry (won=%s, tx %s)", game_id, won, tx_hash)


async def index_solo_reclaimed(event) -> None:
    """SoloReclaimed: the player took their own stake back."""
    game_id = event["args"]["gameId"]
    async with SessionLocal() as db:
        g = await db.get(SoloGame, game_id)
        if g is None or g.status == "reclaimed":
            return
        g.status = "reclaimed"
        await db.commit()
    log.info("Solo game %s reclaimed by player", game_id)


async def reconcile_open_solo(w3, solo) -> None:
    """Sync any still-open game row against the chain's own status.

    Event indexing alone is not enough: the listener only scans from the
    block it started at, so every reclaim that happened while it was down
    (or before this handler existed) is invisible to it. Those rows stay
    "pending" forever and the app keeps offering Reclaim on a stake the
    player already took back — the reclaim tx then reverts
    GameNotPending, which reads as the app being broken.

    Cheap to run: only touches rows the DB still believes are open.
    """
    from sqlalchemy import select

    if solo is None:
        return

    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(SoloGame).where(SoloGame.status.in_(("pending", "unsettled")))
            )
        ).scalars().all()
        open_ids = [g.game_id for g in rows]

    for game_id in open_ids:
        try:
            status = solo.functions.getGame(game_id).call()[4]
        except Exception:
            continue  # RPC blip — try again next tick
        if status == _ST_PENDING:
            continue  # genuinely still open

        new = {
            _ST_RESOLVED: "resolved",
            _ST_RECLAIMED: "reclaimed",
        }.get(status)
        if new is None:
            continue
        async with SessionLocal() as db:
            g = await db.get(SoloGame, game_id)
            if g is not None and g.status != new:
                g.status = new
                await db.commit()
                log.info("solo %s reconciled to '%s' from chain state", game_id, new)


async def sweep_stale_solo(w3, nft, solo) -> None:
    """Passive monitor for games that never got a live result at all.

    Deliberately does NOT touch the chain: bot_id is a pure escrow
    reference, not a real minted agent, so the old "resolve it by
    simulating a replay" behaviour called nft.getAgent(bot_id) on an
    id that usually doesn't exist and crash-looped. A fight nobody
    played should not be settled by a fabricated replay — the contract's
    reclaim() lets the player take their own stake back after 1h, which
    is the correct outcome. Games that DID get played but failed to
    submit are handled by retry_unsettled_solo() instead.
    """
    from sqlalchemy import select

    cutoff = datetime.now(timezone.utc).timestamp() - SOLO_PENDING_TTL_S
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(SoloGame).where(SoloGame.status == "pending")
            )
        ).scalars().all()
        stale = [
            g.game_id
            for g in rows
            if g.created_at is not None and g.created_at.timestamp() < cutoff
        ]

    if stale:
        log.warning(
            "%d solo game(s) stuck pending >%.0fmin (never settled by live "
            "combat): %s. These are NOT auto-resolved — the player can call "
            "SoloArena.reclaim(gameId) to get their stake back after 1h.",
            len(stale), SOLO_PENDING_TTL_S / 60, stale,
        )
    return


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
                    owner=a["owner"].lower(),
                    name=a["name"],
                    personality=a["personality"],
                    attack=a["attack"],
                    defense=a["defense"],
                    speed=a["speed"],
                    intelligence=a["intelligence"],
                )
            )
        await db.commit()


async def _verify_game_server(w3: Web3, arena, solo) -> None:
    """Loud, one-time startup check: the game-server private key MUST
    derive the SAME address the contracts trust, or every submitResult
    call reverts NotGameServer/onlyGameServer — invisibly, since the
    caller only sees a generic revert. This turns that into an
    unmissable log line instead of a silently-eaten exception later.
    """
    s = get_settings()
    if not s.game_server_private_key:
        log.critical(
            "GAME_SERVER_PRIVATE_KEY not set — NO on-chain results can be "
            "submitted and NO staked win can ever pay out."
        )
        return
    signer = Account.from_key(s.game_server_private_key).address

    # ---- 1. can the signer pay for gas at all?
    # This is checked FIRST and loudest because a correctly-authorised
    # signer with an empty balance fails exactly like a misconfigured one,
    # and it is by far the more common mistake.
    try:
        balance = w3.eth.get_balance(signer)
    except Exception:
        log.exception("could not read game-server balance for %s", signer)
        balance = None

    if balance == 0:
        log.critical(
            "GAME SERVER HAS NO GAS. Account %s holds 0 wei on chain %s. "
            "submitResult() can never be broadcast, so every staked win will "
            "stay Pending and players will have to reclaim() their stake "
            "after 1h instead of being paid 1.8x. FUND THIS ADDRESS.",
            signer, w3.eth.chain_id,
        )
    elif balance is not None:
        log.info(
            "game-server %s funded with %s BOT ✔",
            signer, Web3.from_wei(balance, "ether"),
        )

    # ---- 2. is the signer the account each contract actually trusts?
    async def _check(name: str, contract) -> None:
        if contract is None:
            log.warning("%s address not configured — its results can't be submitted", name)
            return
        try:
            onchain = contract.functions.gameServer().call()
        except Exception:
            # NOT a benign "old ABI" skip any more: gameServer() is in
            # both ABIs now, so reaching here means the address is wrong,
            # the contract isn't deployed, or the RPC is unreachable.
            log.critical(
                "%s.gameServer() could not be read at %s — wrong address, "
                "not deployed, or RPC down. Results for %s cannot be verified "
                "and will likely fail.",
                name, getattr(contract, "address", "?"), name,
            )
            return
        if onchain.lower() != signer.lower():
            log.critical(
                "%s.gameServer() = %s but GAME_SERVER_PRIVATE_KEY signs as %s "
                "— every submitResult on %s WILL revert (NotGameServer) until "
                "these match. Either redeploy %s with the right constructor "
                "arg, or call setGameServer(%s) as the contract owner.",
                name, onchain, signer, name, name, signer,
            )
        else:
            log.info("%s.gameServer() matches signer %s ✔", name, signer)

    await _check("SoloArena", solo)
    await _check("BattleArena", arena)

    # ---- 3. can the house actually cover the wins it is accepting?
    if solo is not None:
        try:
            bankroll = w3.eth.get_balance(solo.address)
            reserved = solo.functions.reserved().call()
            free = bankroll - reserved
            log.info(
                "SoloArena bankroll %s BOT, reserved %s BOT, max new stake %s BOT",
                Web3.from_wei(bankroll, "ether"),
                Web3.from_wei(reserved, "ether"),
                Web3.from_wei(max(0, free) * 10 // 8, "ether"),
            )
            if free <= 0:
                log.critical(
                    "SoloArena has no free bankroll (balance %s <= reserved %s) "
                    "— play() will revert StakeTooLarge for every new stake. "
                    "Call fundHouse() to top it up.",
                    bankroll, reserved,
                )
        except Exception:
            log.exception("SoloArena bankroll check failed")


async def run_listener() -> None:
    s = get_settings()
    if not (s.rpc_url and s.battle_arena_address and s.agent_nft_address):
        log.warning("Chain env not configured — listener disabled")
        return

    w3 = get_w3()
    nft, arena, tournament, league, solo, shop = get_contracts(w3)
    await _verify_game_server(w3, arena, solo)
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
                        await index_solo(ev)
                    for ev in solo.events.SoloReclaimed().get_logs(
                        from_block=frm, to_block=to
                    ):
                        await index_solo_reclaimed(ev)
                    # catches reclaims/resolutions from blocks we never
                    # scanned (listener downtime, pre-existing rows)
                    await reconcile_open_solo(w3, solo)
                    # wins whose settlement tx failed get another go every
                    # tick — this is what actually pays the player
                    await retry_unsettled_solo(w3, solo)
                    await sweep_stale_solo(w3, nft, solo)

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
                        buyer = ev["args"]["buyer"].lower()
                        item_id = ev["args"]["itemId"]
                        catalog_item = ITEM_BY_ID.get(item_id)
                        async with SessionLocal() as db:
                            # Skins/powers are one-per-wallet (same rule as
                            # /market/redeem's points path) — a purchase()
                            # tx on-chain can't be "undone", but we must
                            # not grant a second copy of the same skin/
                            # power just because the buyer paid twice.
                            # Boosts are consumable and stack freely.
                            dup = False
                            if catalog_item is not None and catalog_item.kind != "boost":
                                existing = (
                                    await db.execute(
                                        select(InventoryItem).where(
                                            InventoryItem.wallet == buyer,
                                            InventoryItem.item_id == item_id,
                                        ).limit(1)
                                    )
                                ).scalars().first()
                                dup = existing is not None
                            if dup:
                                log.warning(
                                    "Shop purchase for %s already owned by %s — "
                                    "refund needed, not granting a duplicate",
                                    item_id, buyer,
                                )
                                continue
                            db.add(InventoryItem(
                                wallet=buyer, item_id=item_id, source="bot",
                            ))
                            await db.commit()
                        log.info("Shop purchase granted: %s -> %s", item_id, buyer)

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