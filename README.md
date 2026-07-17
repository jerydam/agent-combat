# äGENT çOMBAT (Agent Combat)

**A real-time, skill-based onchain fighting game on BOT Chain.**

Players mint AI-powered fighter NFTs called Agents, then battle in real
time — landscape mobile, two thumbs, ATTACK and DEFEND — with wins,
losses, XP, evolution, and prize money all settled on-chain. When you're
not around, your Agent fights for itself: its on-chain personality drives
an autonomous AI that defends your league fixtures, staffs the practice
arena, and takes over if you disconnect mid-match.

Live gameplay is server-authoritative (clients only send taps, so
modified clients and autoclickers gain nothing), every battle log is
hashed and committed on-chain for public audit, and the whole economy —
wagers, tournament pools, league prizes, the item shop — runs in BOT, the
native gas token.

---

## Gameplay

### The fight

Rotate your phone (the game auto-rotates and goes fullscreen), two
buttons appear:

- **ATTACK** — tap for a *light* strike, hold ≥350ms for a *heavy* one
  (slower wind-up, +80% damage, punches through sloppy blocks).
- **DEFEND** — opens a **400ms block window**. Block a hit: ~75–85%
  damage reduction. Open your block within **150ms before impact**:
  **PERFECT PARRY** — zero damage, the attacker staggers for half a
  second, and (with the right evolution) you counter automatically.

Under the thumbs sits a stamina economy: every action costs stamina,
regen is slow, and hitting zero means **2 seconds exhausted** — no
attacks, half-size block windows, +25% damage taken. Attacks also have
wind-ups and cooldowns scaled by your SPEED stat, capping everyone
around ~1.5 swings/second.

That combination is the anti-cheat: **button-mashing is not a strategy,
it's a loss.** Our test suite literally runs an autoclicker (both buttons,
every tick) against a mid-level bot — it loses 100% of matches. Optimal
play is rhythm, reading the opponent's wind-up bar, and timing parries.

A match ends by KO or, at the 90-second bell, by score:
`damage dealt + 8×successful defends + 20×perfect parries`.

### Your Agent

Each Agent is an ERC-721 with fully on-chain stats, rolled at mint
(40–90 each + a personality bonus):

| Stat | Effect in combat |
|---|---|
| ATTACK | damage per hit |
| DEFENSE | damage mitigation, block strength, max HP |
| SPEED | faster wind-ups and cooldowns |
| INTELLIGENCE | crit chance, stamina efficiency, AI reaction speed |

**Personality** (permanent, chosen at mint) shapes how the Agent fights
when its AI is in control: **Aggressive** pressures relentlessly,
**Defensive** blocks, regens, and punishes, **Tactical** learns the
opponent's rhythm and strikes between swings.

**Evolution** happens on-chain in `recordBattle`: 25 wins → **Tier 2
Advanced** (unlocks *Counter Attack* — parries reflect 30% damage — and
*Predictive Attack* — you see wind-ups 100ms earlier), 60 wins → **Tier 3
Elite** (adds *Quantum Defense* — 10% of normal blocks upgrade to
perfect). Each evolution also grants +5 INT.

Agents also carry **memory**: before AI-driven fights, the backend loads
the head-to-head record between the two agents — an Agent that keeps
losing to someone fights more carefully next time.

### Game modes (every mode free or paid)

- **1v1 duels** — quick-match instantly against opted-in agents (zero
  stakes), or post a **challenge with a BOT wager**; your opponent
  accepts by matching the stake and the winner takes the pot (2.5% fee).
- **Solo vs the house** — fight house bots (real on-chain agents that
  gain XP and evolve, so difficulty rises over time). Free, or stake BOT
  to win **1.8×** from the house vault, which reserves your potential
  payout at play time so wins are always payable.
- **Leagues (async)** — anyone creates a room: entry fee, max players,
  **start/end date-times**, and an optional **join code**. Double
  round-robin where every player *initiates* one fixture against every
  other player — play YOUR fixtures whenever you're online; the
  opponent's Agent fights autonomously, so they never need to be there.
  Win 3 pts, loss 1 (you showed up), unplayed-by-deadline 0. Final
  standings pay **50/30/20** of the pool.
- **Tournaments** — single-elimination brackets with an on-chain prize
  pool and the same 50/30/20 podium split; the whole bracket derives
  deterministically from an on-chain seed and is publicly replayable.
- **Training** — free sparring, no gas, no records.

### Achievements & Market

Playing earns **achievement points** (14 achievements, from *First
Blood* to *Apex* at 1300 ELO). Spend points — or pay BOT via the Shop
contract — on:

- **Avatar skins** — human-form fighter portraits (10 ship built-in;
  drop any image into `frontend/public/avatars/` + one line in
  `lib/avatars.ts` to add your own).
- **Stat serums** — consume into a **permanent on-chain stat boost**
  (`AgentNFT.boostStats`, sent by the game server, capped per call).
- **Powers** — equippable combat perks the engine applies live:
  *Second Wind* (+20% stamina regen), *Iron Guard* (stronger blocks),
  *Focus Core* (+40ms parry window).

There's also a peer-to-peer **Marketplace** contract for trading Agents
themselves at fixed prices.

### Trust model

- Seeds for AI-simulated battles are fixed **on-chain** (prevrandao)
  before the backend ever sees them; the simulator is a pure function of
  (seed, stats, logged memory) — replays are byte-identical.
- Live matches are input-driven, so instead of seed-determinism every
  result commits a **keccak hash of the full battle log** (`movesHash` /
  `bracketHash` / `standingsHash`) on-chain — anyone can pull the log
  from the API and audit it tap-by-tap.
- Results are settled only by the **game server account**
  (`msg.sender == gameServer`); timeouts refund stakes and free agents
  if the server ever goes down. League fixture plays and all market
  actions require an **EIP-191 wallet signature** from the owner.

---

## Tech stack

| Layer | Tech |
|---|---|
| Chain | **BOT Chain** (EVM, chainId 677, PoSA, ~0.9s finality, gas = BOT) |
| Contracts | Solidity 0.8.28, OpenZeppelin v5, **Foundry** (Hardhat config included) |
| Backend | **Python 3.12 / FastAPI**, SQLAlchemy 2 async, web3.py, WebSockets |
| Realtime | Server-authoritative combat engine, 20Hz asyncio tick loop |
| Database | PostgreSQL (**Supabase**) in prod, SQLite locally |
| Frontend | **Next.js 13 (app router) / TypeScript**, Tailwind + shadcn/ui, **viem** |
| Wallet | Any injected wallet (MetaMask); auto-adds/switches to BOT Chain |
| Hosting | Backend on **Koyeb** (Docker), frontend on Vercel/Netlify |

### Repository layout

```
agent-arena/
├── contracts/               Solidity + Foundry
│   ├── contracts/           AgentNFT, BattleArena, SoloArena, League,
│   │                        Tournament, Marketplace, Shop
│   └── script/              Deploy.s.sol, SetupBots.s.sol
├── backend/
│   ├── app/
│   │   ├── combat/          realtime engine, bot AI, WebSocket rooms
│   │   ├── engine/          deterministic simulator, personalities,
│   │   │                    league fixtures, tournaments, memory
│   │   ├── chain/           web3 client, event listener, boosts
│   │   ├── market/          achievements + item catalog
│   │   └── routers/         REST + WebSocket API
│   ├── tests/               engine + combat + market suites
│   └── Dockerfile           Koyeb-ready
└── frontend/                Next.js app (all pages + combat renderer)
```

---

## Deployment

### 1. Contracts (Foundry)

```bash
cd contracts
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
forge build
```

Create two wallets and fund both with BOT (testnet faucet:
https://faucet.botchain.ai/basic):
- **deployer** — owns the contracts, mints house bots
- **game server** — hot key on the backend; settles results, sends
  boosts. Never reuse the deployer key here.

```bash
export PRIVATE_KEY=0x...                 # deployer key
export GAME_SERVER_ADDRESS=0x...         # game server ADDRESS
export BOTCHAIN_TESTNET_RPC=https://...  # from dev-docs.botchain.ai
export METADATA_BASE_URI=https://<your-koyeb-app>.koyeb.app/metadata/

forge script script/Deploy.s.sol --rpc-url botchain_testnet --broadcast
```

This deploys all seven contracts, authorizes the arenas + game server on
the NFT, and prints every address in env-var format. Copy them, then
mint the house bots and fund the solo vault:

```bash
export AGENT_NFT_ADDRESS=0x... SOLO_ARENA_ADDRESS=0x...
export VAULT_FUNDING_WEI=5000000000000000000   # 5 BOT
forge script script/SetupBots.s.sol --rpc-url botchain_testnet --broadcast
```

Optionally price items for BOT purchases:

```bash
cast send $SHOP_ADDRESS "setPrice(string,uint128)" "av_champion" \
  2000000000000000000 --rpc-url botchain_testnet --private-key $PRIVATE_KEY
```

For mainnet, repeat with `--rpc-url botchain` (chainId 677).

### 2. Backend on Koyeb (Docker)

The backend ships with a production `Dockerfile` (see `backend/`).

1. Push this repo to GitHub.
2. Koyeb → **Create Service → GitHub** → pick the repo, set the **work
   directory to `backend/`** (Koyeb auto-detects the Dockerfile).
3. Instance: the smallest works to start. **Port 8000**, health check
   path `/health`.
4. Environment variables (Koyeb → Settings → Environment):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** string as `postgresql+asyncpg://...` |
| `RPC_URL` | BOT Chain RPC |
| `CHAIN_ID` | `677` (or testnet id) |
| `AGENT_NFT_ADDRESS` … `SHOP_ADDRESS` | from the deploy output |
| `GAME_SERVER_PRIVATE_KEY` | the game server key (keep it BOT-funded — it pays result gas) |
| `BOT_OWNER_ADDRESS` | the wallet that minted the house bots |
| `CORS_ORIGINS` | your frontend URL(s), comma-separated |

5. Deploy. Logs should show `Listener started at block N` — that's the
   game loop watching the chain. WebSockets work on Koyeb out of the box
   (the combat rooms need them).

Local dev instead: `pip install -r requirements.txt && uvicorn
app.main:app --reload` (SQLite by default, chain env optional — the
practice arena works with none of it).

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL = your Koyeb URL,
                             # RPC, and the NEXT_PUBLIC_* addresses
npm install && npm run dev   # or deploy to Vercel with the same env
```

### Smoke test, end to end

1. Open the app on your phone → `/combat` → FIGHT (works before any
   chain setup — practice is chain-free).
2. Connect wallet → mint an agent → it appears on the dashboard within
   seconds (listener mirroring `AgentMinted`).
3. Second wallet: mint, enable quick-match, fight — watch the replay
   land with the on-chain tx link.
4. `/achievements` → claim → `/market` → redeem a skin → your roster
   card wears it.

---

## Tests

```bash
cd backend
python tests/test_engine.py   # deterministic sim: balance, determinism, tiers
python tests/test_combat.py   # realtime: anti-mash, rate caps, parries
```

## License

MIT — build on it.