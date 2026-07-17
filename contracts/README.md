# Agent Arena — Contracts (Phase 1)

Smart contract layer for Agent Arena on **BOT Chain** (EVM, chainId 677,
gas token BOT, explorer: https://scan.botchain.ai).

## Contracts

**AgentNFT.sol** — ERC721 agents with fully on-chain stats (attack, defense,
speed, intelligence, level, XP, W/L record) and 3 personalities. Stats roll
pseudo-randomly at mint (40–90 base + personality bonus). Only the
authorized BattleArena can write battle results; leveling is automatic
(+1 level per 500 XP with stat bumps). Max 5 agents per wallet.

**BattleArena.sol** — battle lifecycle:

1. `createBattle(myAgent, opponentAgent)` locks both agents and fixes an
   on-chain `seed` from `prevrandao` at creation.
2. The FastAPI backend watches `BattleCreated`, runs the AI battle engine
   **deterministically from that seed + on-chain stats**, and signs the
   result (EIP-712, domain `AgentArena` v1).
3. `submitResult(battleId, winnerAgent, movesHash, signature)` verifies the
   signature against `gameSigner`, awards XP (100 win / 25 loss), and frees
   the agents. `movesHash` commits to the full battle log so anyone can
   audit the replay against the seed.
4. `cancelStaleBattle` frees agents if the backend goes down (1h timeout).

### Trust model (important)

Phase 1 stakes nothing, so a trusted `gameSigner` is acceptable. The seed
being fixed on-chain at creation means the backend **cannot re-roll**
outcomes — it can only refuse to settle, which `cancelStaleBattle` handles.
Before adding wagers (zClash-style), move damage resolution on-chain and
reduce the backend to strategy selection only.

## Backend signing (FastAPI side)

```python
from eth_account import Account
from eth_account.messages import encode_typed_data

domain = {
    "name": "AgentArena", "version": "1",
    "chainId": 677, "verifyingContract": ARENA_ADDRESS,
}
types = {"BattleResult": [
    {"name": "battleId", "type": "uint256"},
    {"name": "winnerAgent", "type": "uint256"},
    {"name": "movesHash", "type": "bytes32"},
]}
message = {"battleId": battle_id, "winnerAgent": winner, "movesHash": moves_hash}
signed = Account.sign_typed_data(SIGNER_KEY, domain, types, message)
# submit signed.signature with submitResult()
```

## Deploy

```bash
npm install
cp .env.example .env   # fill PRIVATE_KEY, BOTCHAIN_RPC, GAME_SIGNER_ADDRESS
npx hardhat run script/deploy.ts --network botchainTestnet
```

Get the testnet RPC/chainId from https://dev-docs.botchain.ai and testnet
BOT from https://faucet.botchain.ai/basic.

## Next (Phase 1 remaining)

- FastAPI battle engine: event listener → deterministic simulation →
  EIP-712 signing → submitResult
- Next.js frontend: mint flow, agent card, battle screen, leaderboard
- Supabase: battle logs (full move lists behind movesHash), rankings
