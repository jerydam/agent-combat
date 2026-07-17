# Agent Arena — Frontend

Next.js 13 (app router) + shadcn/Tailwind, integrated with the Agent Arena
contracts on BOT Chain and the FastAPI backend.

## Setup

```bash
npm install
cp .env.example .env.local   # API URL, RPC, and the 6 contract addresses
npm run dev
```

Wallet: MetaMask or any injected wallet — the app auto-adds/switches to
BOT Chain (chainId 677).

## Pages

- `/` landing · `/dashboard` roster · `/create` mint (3 personalities,
  stats roll on-chain)
- `/arena` 1v1: quick-match (free, opt-in targets), challenge with a BOT
  stake, accept challenges by ID, toggle quick-match availability
- `/battle?id=N` verified replay — polls the backend until the listener
  resolves, then animates the round-by-round engine log
- `/training` free sparring via the preview endpoint (no gas, no records)
- `/solo` vs house bots — free or staked (1.8x on a win)
- `/leagues` create rooms (entry fee, max players, start/end date-times,
  join code) and join with a code
- `/leagues/[id]` room: live points table, YOUR fixtures with "Play now"
  (signs `agent-arena:play:{league}:{idx}` with your wallet — opponents
  can be offline), fixture replays
- `/tournaments` enter + podium results
- `/leaderboard` ELO ranking · `/agents/[id]` agent profile + history

## Data flow

- Writes go through the wallet (viem): mint, challenge/accept/quickMatch,
  solo play, league create/join, tournament enter.
- Reads come from the FastAPI backend (agents cache, battles, standings,
  bots, matchmaking) — see `lib/api.ts`.
- `lib/contracts.ts` holds addresses + minimal ABIs; `lib/chain.ts`
  defines BOT Chain and lazy viem clients.
