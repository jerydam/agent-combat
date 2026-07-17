# Agent Arena — Full Build

AI-powered onchain battle game on **BOT Chain** (EVM, chainId 677, ~0.9s
finality). Players mint autonomous NFT agents that battle, evolve, enter
tournaments with on-chain prize pools, wager BOT in duels, and trade on a
marketplace.

```
agent-arena/
├── contracts/           Solidity (Hardhat, OZ v5)
│   ├── AgentNFT.sol     agents: on-chain stats, XP, levels, EVOLUTION TIERS
│   ├── BattleArena.sol  challenge/accept + BOT wagers + quick-match opt-in
│   ├── Tournament.sol   entry fees pool on-chain, signed podium, 50/30/20
│   └── Marketplace.sol  fixed-price agent trading, 2.5% fee
└── backend/             FastAPI: API, AI engine, chain listener, signer
frontend/                ← yours (integration guide below)
```

## Gameplay

**Stats** (rolled on-chain at mint, 40–90 + personality bonus): attack
scales damage, defense mitigates (diminishing returns), speed decides
strike order, intelligence drives crits and opponent reads.
`max_hp = 100 + level*10 + defense/2`.

**Moves** — both agents pick simultaneously each round:

| Move         | Energy | Dmg | Acc | Notes                                  |
|--------------|--------|-----|-----|----------------------------------------|
| Strike       | 10     | 12  | 95% | bread and butter                       |
| Power Strike | 30     | 26  | 80% | payoff move                            |
| Guard        | 0      | —   | —   | halve incoming, +20 energy             |
| Analyze      | 5      | —   | —   | +focus (max 3): +15% dmg / +8% acc, fades 1 per hit |
| Finisher     | 45     | 40  | 70% | only when opponent < 35% HP            |

Energy +10/round, max 25 rounds, tiebreak HP% → speed.

**Personalities:** Aggressive (tempo, greedy finishers), Defensive
(guards, regens, outlasts), Tactical (stacks focus early, reads the
opponent via intelligence). Balance at equal stats: 40/33/28 win share.

**Evolution** (on-chain, in `recordBattle`): 25 wins → Tier 2
*Advanced*, 60 wins → Tier 3 *Elite*, each +5 intelligence. Tiers unlock
engine abilities:
- Tier 2: **Predictive Attack** (sharper reads) and **Counter Attack**
  (reflect 30% of damage blocked while guarding)
- Tier 3: + **Quantum Defense** (10% chance to fully negate a hit while
  guarding)

Measured: tier-3 beats an identical tier-1 agent ~59% of the time — an
edge, not an auto-win.

**Agent memory:** before each battle the backend loads the head-to-head
record between the two agents and feeds it to the policies — agents that
keep losing to an opponent fight more carefully, and familiarity improves
reads. Memory inputs are embedded in the battle log, so replays stay
byte-reproducible.

## Real-time combat (Agent Combat)

Battles are now played, not watched: landscape mobile, DEFEND and ATTACK
buttons (tap = light, hold = heavy), timed block windows with perfect
parries, stamina, and Mortal-Kombat-style life bars. The server owns
every rule — `backend/app/combat/engine.py` runs an authoritative 20Hz
tick loop over WebSocket; clients only send taps, so modified clients and
autoclickers gain nothing (verified in tests: a both-buttons masher loses
100% of matches vs a mid bot). Bot opponents run the same personality
engine in real time (`bot_ai.py`), tier abilities apply (parry-counter,
earlier telegraphs, quantum blocks), and the full timestamped input trace
backs `movesHash`. Try it: run the backend, `npm run dev`, open
`/combat` — works with zero chain setup. Tune the feel in
`TUNING` (engine.py).

## Game modes (all free or paid)

1. **Challenge** — `challenge(myAgent, target)` with optional BOT stake
   (`msg.value`). Opponent `accept(battleId)` matches the stake; the seed
   is fixed at accept, after both sides committed. Winner takes the pot
   minus 2.5% fee. Unaccepted challenges refundable anytime by the
   challenger, or sweepable by anyone after 24h.
2. **Quick match** — zero stakes, instant, vs agents whose owners opted
   in via `setQuickMatch(agentId, true)`. No consent griefing.
3. **Solo (player vs bot)** — house bots are real on-chain agents (they
   gain XP and evolve too, so difficulty grows naturally). Free play:
   `SoloArena.play(agent, bot)` with 0 value. Staked: send BOT with the
   call — beat the bot and win **1.8x your stake** from the house vault.
   The vault reserves liability at play time, so a win can never be
   unpayable; unresolved games refundable after 1h. Owner ops: mint bots
   from the bot wallet, `setBot(id, true)`, `fundVault()`.
4. **Leagues (async)** — anyone creates a room: entry fee (0 = free),
   max players, **start/end date-times**, and an optional **join code**
   (room stores `keccak256(code)`; players join with the code before the
   start time). After start, anyone calls `activate()` — 3+ players —
   fixing the league seed. Double round-robin: every player *initiates*
   one fixture against every other player. You play YOUR fixtures
   whenever you're online inside the window — the opponent's agent
   fights autonomously, so they don't need to be there; they play the
   reverse fixture on their own time. Points: **win 3 · loss 1 ·
   unplayed-by-deadline 0 (forfeit)**. Standings tiebreak: HP%
   differential → wins → token id. After the end time the backend
   forfeits unplayed fixtures, computes the table, and submits signed
   standings — prizes 50/30/20 of the pool. Dead rooms (<3 players) and
   stuck leagues are fully refundable.
5. **Tournaments** — owner creates (entry fee, max entrants, deadline);
   players `enter(tid, agentId)` paying the fee into the on-chain pool;
   anyone calls `start(tid)` after the deadline (4+ entrants), fixing the
   bracket seed. Backend derives the bracket + every match seed
   deterministically, simulates all rounds, submits the signed podium.
   Prizes 50/30/20 of the post-fee pool; cancelled tournaments are fully
   refundable per entrant.

## Trust model

1. Seeds are fixed **on-chain** (prevrandao) before the backend sees them
   — at accept/quickMatch for duels, at start for tournaments.
2. The simulator is a **pure function** of (seed, on-chain stats, logged
   memory inputs). Byte-identical replays, verified in tests.
3. Full logs are hashed (keccak of canonical JSON) into `movesHash` /
   `bracketHash`, signed via **EIP-712**, committed on-chain. Anyone can
   pull `GET /battles/{id}` or `GET /tournaments/{id}`, re-run the
   open-source engine, and verify.
4. Liveness: `cancelStaleBattle` (1h) refunds stakes and frees agents;
   stuck tournaments cancellable after 48h with per-entrant refunds.

Honest caveat: a malicious signer key could sign a fake result — it
can't forge the *log* (audits would catch it publicly), but it moves the
money once. Keep the signer key isolated on Koyeb, rotate via
`setGameSigner`, and treat "fully on-chain damage math" as the endgame
hardening step for high-stakes play.

## Runbook

**Contracts:**
```bash
cd contracts && npm install
cp .env.example .env   # PRIVATE_KEY, RPC, GAME_SIGNER_ADDRESS
npx hardhat run script/deploy.ts --network botchainTestnet
```
Deploys AgentNFT, BattleArena, Tournament, Marketplace and authorizes the
arena. Testnet RPC/chainId: dev-docs.botchain.ai · faucet:
faucet.botchain.ai/basic. Fund the game signer with BOT (it pays gas for
submitResult / submitPodium).

**Backend:**
```bash
cd backend && pip install -r requirements.txt
cp .env.example .env   # addresses, RPC, signer key, Supabase URL
uvicorn app.main:app --reload
```
The listener resolves duels (ChallengeAccepted, QuickMatchStarted) and
tournaments (TournamentStarted), mirrors AgentMinted, and maintains ELO
(K=32, start 1000). Supabase: use the session pooler string as
`postgresql+asyncpg://...`.

**Tests:** `cd backend && python tests/test_engine.py`

## Frontend integration

On-chain writes (wagmi/viem):
- `AgentNFT.mintAgent(name, personality)` — 0 Aggressive / 1 Defensive / 2 Tactical
- `BattleArena.challenge(myAgent, target)` payable · `accept(battleId)` payable
- `BattleArena.quickMatch(myAgent, target)` · `setQuickMatch(agentId, bool)`
- `BattleArena.cancelChallenge(battleId)` / `cancelStaleBattle(battleId)`
- `SoloArena.play(agentId, botId)` payable (0 = free) · `refundStale(gameId)`
- `League.createLeague(fee, maxPlayers, start, end, keccak256(code) | 0x0)`
- `League.join(leagueId, code, agentId)` payable · `activate(leagueId)`
- `Tournament.enter(tid, agentId)` payable
- `Marketplace.list/delist/buy` (approve the marketplace first)

API:
- `GET /agents?owner=0x..` · `GET /agents/{id}` · `GET /agents/{id}/preview?opponent_id=X&seed=N`
- `GET /matchmaking/{id}` — ELO-near opponents to challenge
- `GET /battles?agent_id=X` · `GET /battles/{id}` — round-by-round log
  (`moves.rounds[].events[]`: move, damage, hit, crit, countered)
- `GET /solo/bots` — house bot roster · `GET /solo/games?agent_id=X`
- `GET /leagues` · `GET /leagues/{id}` — room, fixtures, LIVE standings
- `GET /leagues/{id}/fixtures/{agentId}` — your unplayed "home games"
- `POST /leagues/{id}/fixtures/{idx}/play` — body `{wallet, signature}`
  where signature is EIP-191 over `agent-arena:play:{leagueId}:{idx}`
  (only the initiating agent's owner can play; opponent can be offline)
- `GET /tournaments` · `GET /tournaments/{tid}` — full bracket + logs
- `GET /leaderboard` · `POST /users` · `GET /metadata/{id}`

Duel flow: `challenge`/`quickMatch` → poll `GET /battles/{battleId}`
until `status == "resolved"` (seconds) → animate `moves.rounds`.
