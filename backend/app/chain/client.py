"""Web3 client for BOT Chain + minimal contract ABIs."""

from web3 import Web3

from ..config import get_settings

AGENT_NFT_ABI = [
    {
        "name": "getAgent",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [
            {
                "components": [
                    {"name": "attack", "type": "uint16"},
                    {"name": "defense", "type": "uint16"},
                    {"name": "speed", "type": "uint16"},
                    {"name": "intelligence", "type": "uint16"},
                    {"name": "level", "type": "uint16"},
                    {"name": "wins", "type": "uint32"},
                    {"name": "losses", "type": "uint32"},
                    {"name": "experience", "type": "uint64"},
                    {"name": "lastBattleAt", "type": "uint64"},
                    {"name": "personality", "type": "uint8"},
                    {"name": "tier", "type": "uint8"},
                ],
                "name": "",
                "type": "tuple",
            },
            {"name": "name", "type": "string"},
        ],
    },
    {
        "name": "ownerOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "address"}],
    },
    {
        "name": "AgentMinted",
        "type": "event",
        "anonymous": False,
        "inputs": [
            {"name": "tokenId", "type": "uint256", "indexed": True},
            {"name": "owner", "type": "address", "indexed": True},
            {"name": "name", "type": "string", "indexed": False},
            {"name": "personality", "type": "uint8", "indexed": False},
            {"name": "attack", "type": "uint16", "indexed": False},
            {"name": "defense", "type": "uint16", "indexed": False},
            {"name": "speed", "type": "uint16", "indexed": False},
            {"name": "intelligence", "type": "uint16", "indexed": False},
        ],
    },
]

BATTLE_ARENA_ABI = [
    {
        "name": "ChallengeAccepted",
        "type": "event",
        "anonymous": False,
        "inputs": [
            {"name": "battleId", "type": "uint256", "indexed": True},
            {"name": "seed", "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "QuickMatchStarted",
        "type": "event",
        "anonymous": False,
        "inputs": [
            {"name": "battleId", "type": "uint256", "indexed": True},
            {"name": "agentA", "type": "uint256", "indexed": True},
            {"name": "agentB", "type": "uint256", "indexed": True},
            {"name": "seed", "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "getBattle",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "battleId", "type": "uint256"}],
        "outputs": [
            {
                "components": [
                    {"name": "agentA", "type": "uint256"},
                    {"name": "agentB", "type": "uint256"},
                    {"name": "playerA", "type": "address"},
                    {"name": "playerB", "type": "address"},
                    {"name": "stake", "type": "uint128"},
                    {"name": "seed", "type": "uint256"},
                    {"name": "createdAt", "type": "uint64"},
                    {"name": "status", "type": "uint8"},
                    {"name": "winnerAgent", "type": "uint256"},
                ],
                "name": "",
                "type": "tuple",
            }
        ],
    },
    {
        "name": "submitResult",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "battleId", "type": "uint256"},
            {"name": "winnerAgent", "type": "uint256"},
            {"name": "movesHash", "type": "bytes32"},
        ],
        "outputs": [],
    },
]


TOURNAMENT_ABI = [
    {
        "name": "TournamentStarted",
        "type": "event",
        "anonymous": False,
        "inputs": [
            {"name": "tournamentId", "type": "uint256", "indexed": True},
            {"name": "bracketSeed", "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "getEntrants",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "tid", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256[]"}],
    },
    {
        "name": "submitPodium",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "tid", "type": "uint256"},
            {"name": "first", "type": "uint256"},
            {"name": "second", "type": "uint256"},
            {"name": "third", "type": "uint256"},
            {"name": "bracketHash", "type": "bytes32"},
        ],
        "outputs": [],
    },
]


LEAGUE_ABI = [
    {
        "name": "LeagueActivated",
        "type": "event",
        "anonymous": False,
        "inputs": [
            {"name": "leagueId", "type": "uint256", "indexed": True},
            {"name": "seed", "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "rooms",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "", "type": "uint256"}],
        "outputs": [
            {"name": "creator", "type": "address"},
            {"name": "entryFee", "type": "uint128"},
            {"name": "maxPlayers", "type": "uint32"},
            {"name": "startTime", "type": "uint64"},
            {"name": "endTime", "type": "uint64"},
            {"name": "codeHash", "type": "bytes32"},
            {"name": "seed", "type": "uint256"},
            {"name": "status", "type": "uint8"},
            {"name": "pool", "type": "uint256"},
        ],
    },
    {
        "name": "getEntrants",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "leagueId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256[]"}],
    },
    {
        "name": "submitStandings",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "leagueId", "type": "uint256"},
            {"name": "first", "type": "uint256"},
            {"name": "second", "type": "uint256"},
            {"name": "third", "type": "uint256"},
            {"name": "standingsHash", "type": "bytes32"},
        ],
        "outputs": [],
    },
]

SOLO_ABI = [
    {
        "name": "SoloPlayed",
        "type": "event",
        "anonymous": False,
        "inputs": [
            {"name": "gameId", "type": "uint256", "indexed": True},
            {"name": "agentId", "type": "uint256", "indexed": True},
            {"name": "botId", "type": "uint256", "indexed": True},
            {"name": "player", "type": "address", "indexed": False},
            {"name": "stake", "type": "uint128", "indexed": False},
            {"name": "seed", "type": "uint256", "indexed": False},
        ],
    },
    {
        "name": "submitResult",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "gameId", "type": "uint256"},
            {"name": "playerWon", "type": "bool"},
            {"name": "movesHash", "type": "bytes32"},
        ],
        "outputs": [],
    },
]


def get_w3() -> Web3:
    return Web3(Web3.HTTPProvider(get_settings().rpc_url))


def get_contracts(w3: Web3):
    s = get_settings()
    nft = w3.eth.contract(
        address=Web3.to_checksum_address(s.agent_nft_address),
        abi=AGENT_NFT_ABI,
    )
    arena = w3.eth.contract(
        address=Web3.to_checksum_address(s.battle_arena_address),
        abi=BATTLE_ARENA_ABI,
    )
    tournament = None
    if s.tournament_address:
        tournament = w3.eth.contract(
            address=Web3.to_checksum_address(s.tournament_address),
            abi=TOURNAMENT_ABI,
        )
    league = None
    if s.league_address:
        league = w3.eth.contract(
            address=Web3.to_checksum_address(s.league_address), abi=LEAGUE_ABI
        )
    solo = None
    if s.solo_arena_address:
        solo = w3.eth.contract(
            address=Web3.to_checksum_address(s.solo_arena_address), abi=SOLO_ABI
        )
    return nft, arena, tournament, league, solo
