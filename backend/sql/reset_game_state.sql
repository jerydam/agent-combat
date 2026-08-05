-- Wipe all testnet game state before running on BOT Chain mainnet (677).
--
-- Why this is needed: nothing in models.py carries a chain identifier.
-- `agents` is keyed by token_id alone and `player_progress` by wallet
-- alone, so rows written while the game ran on testnet are
-- indistinguishable from mainnet rows — and because every redeploy
-- restarts token IDs at 1, a leftover testnet agent sits exactly where
-- the first mainnet mint belongs.
--
-- This DELETES ALL PLAYER POINTS, AGENTS, AND MATCH HISTORY. Take a
-- Supabase snapshot first if you want the testnet data back.
--
-- Run against the Supabase Postgres in DATABASE_URL:
--   psql "$DATABASE_URL" -f backend/sql/reset_game_state.sql
-- or paste into the Supabase SQL editor.
--
-- `arena_players` (wallet -> username) is intentionally left alone: it is
-- chain-independent identity, not game state. Drop it from the list below
-- only if you also want to clear usernames.

BEGIN;

TRUNCATE TABLE
    fixtures,
    leagues,
    tournaments,
    battles,
    combat_matches,
    solo_games,
    inventory,
    agent_loadouts,
    player_progress,
    agents
RESTART IDENTITY CASCADE;

COMMIT;

-- Sanity check — every count must be 0.
SELECT 'agents' AS table, count(*) FROM agents
UNION ALL SELECT 'player_progress', count(*) FROM player_progress
UNION ALL SELECT 'battles', count(*) FROM battles
UNION ALL SELECT 'solo_games', count(*) FROM solo_games
UNION ALL SELECT 'combat_matches', count(*) FROM combat_matches
UNION ALL SELECT 'inventory', count(*) FROM inventory
UNION ALL SELECT 'agent_loadouts', count(*) FROM agent_loadouts
UNION ALL SELECT 'tournaments', count(*) FROM tournaments
UNION ALL SELECT 'leagues', count(*) FROM leagues
UNION ALL SELECT 'fixtures', count(*) FROM fixtures;
