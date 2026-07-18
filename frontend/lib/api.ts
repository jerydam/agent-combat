import type {
  Agent,
  Battle,
  BattleLog,
  Bot,
  LeagueInfo,
  MatchmakingEntry,
  SoloGame,
  StandingsRow,
  TournamentInfo,
} from './types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  upsertUser: (wallet: string, username = '') =>
    post('/users', { wallet, username }),

  agents: (owner?: string) =>
    get<Agent[]>(`/agents${owner ? `?owner=${owner.toLowerCase()}` : ''}`),
  /** Backfill this wallet's mints straight from the chain (recovers
   *  agents the listener missed while the backend was down). */
  syncAgents: (owner: string) =>
    post<{ found: number; added: number }>('/agents/sync', { owner }),
  inventory: (wallet: string) =>
    get<{ points: number; items: { id: number; item_id: string; source: string; consumed: boolean }[] }>(
      `/market/inventory/${wallet}`,
    ),
  marketCatalog: () =>
    get<{
      points_per_usd: number;
      bot_usd_price: number;
      items: {
        id: string; kind: 'skin' | 'boost' | 'power'; name: string; desc: string;
        point_price: number; usd_price: number; bot_price_wei: string;
        boost: number[] | null; power: Record<string, number> | null;
      }[];
    }>('/market/catalog'),
  agent: (id: number) => get<Agent>(`/agents/${id}`),
  preview: (id: number, opponentId: number, seed: number) =>
    get<BattleLog>(`/agents/${id}/preview?opponent_id=${opponentId}&seed=${seed}`),

  matchmaking: (id: number) => get<MatchmakingEntry[]>(`/matchmaking/${id}`),

  battles: (agentId?: number) =>
    get<Battle[]>(`/battles${agentId != null ? `?agent_id=${agentId}` : ''}`),
  battle: (id: number) => get<Battle>(`/battles/${id}`),

  leaderboard: () => get<Agent[]>('/leaderboard'),

  bots: () => get<Bot[]>('/solo/bots'),
  soloGames: (agentId?: number) =>
    get<SoloGame[]>(`/solo/games${agentId != null ? `?agent_id=${agentId}` : ''}`),
  soloGame: (id: number) => get<SoloGame>(`/solo/games/${id}`),

  leagues: () => get<LeagueInfo[]>('/leagues'),
  league: (id: number) => get<LeagueInfo>(`/leagues/${id}`),
  myFixtures: (leagueId: number, agentId: number) =>
    get(`/leagues/${leagueId}/fixtures/${agentId}`),
  playFixture: (leagueId: number, idx: number, wallet: string, signature: string) =>
    post<{ fixture: number; battle: BattleLog; standings: StandingsRow[] }>(
      `/leagues/${leagueId}/fixtures/${idx}/play`,
      { wallet, signature },
    ),

  tournaments: () => get<TournamentInfo[]>('/tournaments'),
  tournament: (id: number) => get<TournamentInfo>(`/tournaments/${id}`),
};

/** Poll a battle until the listener resolves it (a few seconds on BOT Chain). */
export async function waitForBattle(
  battleId: number,
  timeoutMs = 30_000,
): Promise<Battle> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const b = await api.battle(battleId);
      if (b.status === 'resolved') return b;
    } catch {
      /* not indexed yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Battle not resolved yet — check back shortly');
}

export async function waitForSolo(
  gameId: number,
  timeoutMs = 30_000,
): Promise<SoloGame> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const g = await api.soloGame(gameId);
      if (g.status === 'resolved') return g;
    } catch {
      /* not indexed yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Game not resolved yet — check back shortly');
}
