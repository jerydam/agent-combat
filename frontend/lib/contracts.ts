import type { Address } from 'viem';

export const ADDRESSES = {
  agentNFT: (process.env.NEXT_PUBLIC_AGENT_NFT ?? '0x') as Address,
  battleArena: (process.env.NEXT_PUBLIC_BATTLE_ARENA ?? '0x') as Address,
  soloArena: (process.env.NEXT_PUBLIC_SOLO_ARENA ?? '0x') as Address,
  league: (process.env.NEXT_PUBLIC_LEAGUE ?? '0x') as Address,
  tournament: (process.env.NEXT_PUBLIC_TOURNAMENT ?? '0x') as Address,
  marketplace: (process.env.NEXT_PUBLIC_MARKETPLACE ?? '0x') as Address,
} as const;

export const AGENT_NFT_ABI = [
  {
    name: 'mintAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'personality', type: 'uint8' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

export const BATTLE_ARENA_ABI = [
  {
    name: 'challenge',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'myAgent', type: 'uint256' },
      { name: 'targetAgent', type: 'uint256' },
    ],
    outputs: [{ name: 'battleId', type: 'uint256' }],
  },
  {
    name: 'accept',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'battleId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'quickMatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'myAgent', type: 'uint256' },
      { name: 'targetAgent', type: 'uint256' },
    ],
    outputs: [{ name: 'battleId', type: 'uint256' }],
  },
  {
    name: 'setQuickMatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'enabled', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'getBattle',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'battleId', type: 'uint256' }],
    outputs: [
      {
        components: [
          { name: 'agentA', type: 'uint256' },
          { name: 'agentB', type: 'uint256' },
          { name: 'playerA', type: 'address' },
          { name: 'playerB', type: 'address' },
          { name: 'stake', type: 'uint128' },
          { name: 'seed', type: 'uint256' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'status', type: 'uint8' },
          { name: 'winnerAgent', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
  },
  {
    name: 'ChallengeCreated',
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'battleId', type: 'uint256', indexed: true },
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
      { name: 'playerA', type: 'address', indexed: false },
      { name: 'playerB', type: 'address', indexed: false },
      { name: 'stake', type: 'uint128', indexed: false },
    ],
  },
  {
    name: 'QuickMatchStarted',
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'battleId', type: 'uint256', indexed: true },
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
      { name: 'seed', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const SOLO_ARENA_ABI = [
  {
    name: 'play',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'botId', type: 'uint256' },
    ],
    outputs: [{ name: 'gameId', type: 'uint256' }],
  },
  {
    // Recovers a stake whose fight never got a live result submitted
    // (closed tab, connection dropped, backend down). Only the game's
    // own player can call it, and only once RECLAIM_AFTER (1h) has
    // passed since play(). No backend involvement at all.
    name: 'reclaim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getGame',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [
      { name: 'player', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'botId', type: 'uint256' },
      { name: 'stake', type: 'uint256' },
      { name: 'status', type: 'uint8' }, // 0 None 1 Pending 2 Resolved 3 Reclaimed
      { name: 'playerWon', type: 'bool' },
    ],
  },
  {
    name: 'SoloPlayed',
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'botId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: false },
      { name: 'stake', type: 'uint128', indexed: false },
      { name: 'seed', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'SoloReclaimed',
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'stake', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const LEAGUE_ABI = [
  {
    name: 'createLeague',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'entryFee', type: 'uint128' },
      { name: 'maxPlayers', type: 'uint32' },
      { name: 'startTime', type: 'uint64' },
      { name: 'endTime', type: 'uint64' },
      { name: 'codeHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'leagueId', type: 'uint256' }],
  },
  {
    name: 'join',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'leagueId', type: 'uint256' },
      { name: 'code', type: 'string' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'activate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'leagueId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'rooms',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'entryFee', type: 'uint128' },
      { name: 'maxPlayers', type: 'uint32' },
      { name: 'startTime', type: 'uint64' },
      { name: 'endTime', type: 'uint64' },
      { name: 'codeHash', type: 'bytes32' },
      { name: 'seed', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'pool', type: 'uint256' },
    ],
  },
  {
    name: 'nextLeagueId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEntrants',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'leagueId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const;

export const TOURNAMENT_ABI = [
  {
    name: 'enter',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tid', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'tournaments',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'entryFee', type: 'uint128' },
      { name: 'maxEntrants', type: 'uint32' },
      { name: 'registrationEnd', type: 'uint64' },
      { name: 'startedAt', type: 'uint64' },
      { name: 'bracketSeed', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'pool', type: 'uint256' },
    ],
  },
] as const;