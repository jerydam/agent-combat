"""Battle log hashing.

Results are settled by the game-server account directly (msg.sender check
on-chain), so no signatures are needed. movesHash / bracketHash /
standingsHash still commit the full replay on-chain for public audits.
"""

import json

from web3 import Web3


def moves_hash(battle_log: dict) -> bytes:
    canonical = json.dumps(
        battle_log, sort_keys=True, separators=(",", ":")
    ).encode()
    return Web3.keccak(canonical)
