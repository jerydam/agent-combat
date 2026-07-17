"""On-chain stat boosts: the game-server account calls AgentNFT.boostStats.

Requires the game server address to be authorized on AgentNFT:
    nft.setArena(GAME_SERVER_ADDRESS, true)
(the deploy script does this).
"""

from __future__ import annotations

import asyncio

from eth_account import Account
from web3 import Web3

from ..config import get_settings

BOOST_ABI = [{
    "name": "boostStats",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
        {"name": "tokenId", "type": "uint256"},
        {"name": "atk", "type": "uint16"},
        {"name": "def", "type": "uint16"},
        {"name": "spd", "type": "uint16"},
        {"name": "intel", "type": "uint16"},
    ],
    "outputs": [],
}]


def _send(token_id: int, boost: tuple[int, int, int, int]) -> str:
    s = get_settings()
    if not (s.rpc_url and s.agent_nft_address and s.game_server_private_key):
        raise RuntimeError("Chain env not configured")
    w3 = Web3(Web3.HTTPProvider(s.rpc_url))
    nft = w3.eth.contract(
        address=Web3.to_checksum_address(s.agent_nft_address), abi=BOOST_ABI
    )
    acct = Account.from_key(s.game_server_private_key)
    tx = nft.functions.boostStats(token_id, *boost).build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address),
        "chainId": s.chain_id,
    })
    signed = acct.sign_transaction(tx)
    return w3.eth.send_raw_transaction(signed.raw_transaction).hex()


async def send_boost(token_id: int, boost: tuple[int, int, int, int]) -> str:
    return await asyncio.to_thread(_send, token_id, boost)
