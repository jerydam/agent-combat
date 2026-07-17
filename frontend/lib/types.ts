// API + chain aligned types

export type PersonalityId = 0 | 1 | 2;
export const PERSONALITY_NAMES = ['Aggressive', 'Defensive', 'Tactical'] as const;
export type PersonalityName = (typeof PERSONALITY_NAMES)[number];

export const TIER_NAMES: Record<number, string> = {
  1: 'Basic',
  2: 'Advanced',
  3: 'Elite',
};

export interface Agent {
  token_id: number;
  owner: string;
  name: string;
  personality: PersonalityId;
  attack: number;
  defense: number;
  speed: number;
  intelligence: number;
  level: number;
  experience: number;
  wins: number;
  losses: number;
  ranking_points: number;
  tier?: number;
}

export interface BattleEvent {
  agent: number;
  move: string;
  damage?: number;
  hit?: boolean;
  crit?: boolean;
  target_hp?: number;
  countered?: number;
  attacker_hp?: number;
}

export interface BattleRound {
  round: number;
  events: BattleEvent[];
}

export interface BattleLog {
  seed: string;
  winner: number;
  total_rounds: number;
  agent_a: { token_id: number; name: string; final_hp: number; max_hp: number };
  agent_b: { token_id: number; name: string; final_hp: number; max_hp: number };
  rounds: BattleRound[];
}

export interface Battle {
  battle_id: number;
  agent_a: number;
  agent_b: number;
  status: 'pending' | 'resolved' | 'cancelled';
  winner_agent: number;
  moves: BattleLog | Record<string, never>;
  moves_hash: string;
  tx_hash: string;
}

export interface MatchmakingEntry {
  token_id: number;
  name: string;
  level: number;
  ranking_points: number;
  wins: number;
  losses: number;
  elo_gap: number;
}

export interface Bot extends Omit<Agent, 'owner' | 'experience' | 'ranking_points'> {}

export interface SoloGame {
  game_id: number;
  agent_id: number;
  bot_id: number;
  stake_wei: string;
  status: string;
  player_won: boolean;
  moves?: BattleLog;
  tx_hash: string;
}

export interface FixtureInfo {
  index: number;
  initiator: number;
  opponent: number;
  status: 'pending' | 'played' | 'forfeit';
  winner: number;
  hp_diff: number;
}

export interface StandingsRow {
  agent: number;
  points: number;
  played: number;
  wins: number;
  losses: number;
  forfeits: number;
  hp_diff: number;
  position: number;
}

export interface LeagueInfo {
  league_id: number;
  status: string;
  start_time: number;
  end_time: number;
  entrants: number[];
  fixtures?: FixtureInfo[];
  standings?: StandingsRow[];
  standings_hash?: string;
  tx_hash?: string;
}

export interface TournamentInfo {
  tournament_id: number;
  status: string;
  entrants: number[];
  podium: { first?: number; second?: number; third?: number };
  bracket?: any;
  tx_hash: string;
}
