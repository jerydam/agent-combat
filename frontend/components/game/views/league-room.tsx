'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import type { BattleLog, FixtureInfo, LeagueInfo } from '@/lib/types';
import { BattleReplay } from '@/components/game/battle-replay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Swords, Loader2, Trophy } from 'lucide-react';
import { toast } from 'sonner';

function countdown(to: number): string {
  const s = Math.max(0, to - Math.floor(Date.now() / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function LeagueRoomView({ leagueId }: { leagueId: number }) {
  const { address, connected, signMessage } = useWallet();
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [myAgentIds, setMyAgentIds] = useState<number[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [replay, setReplay] = useState<BattleLog | null>(null);

  const refresh = useCallback(() => {
    api.league(leagueId).then(setLeague).catch(() => {});
  }, [leagueId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!connected) return;
    api.agents(address).then((a) => setMyAgentIds(a.map((x) => x.token_id))).catch(() => {});
  }, [connected, address]);

  async function play(fixture: FixtureInfo) {
    setPlaying(fixture.index);
    setReplay(null);
    try {
      const sig = await signMessage(`agent-arena:play:${leagueId}:${fixture.index}`);
      const out = await api.playFixture(leagueId, fixture.index, address, sig);
      setReplay(out.battle);
      refresh();
      toast.success(out.battle.winner === fixture.initiator ? 'Fixture won — +3 points!' : 'Fixture lost — +1 point for showing up');
    } catch (e: any) {
      toast.error(e?.message ?? 'Play failed');
    } finally {
      setPlaying(null);
    }
  }

  if (!league) return <p className="py-24 text-center text-muted-foreground">Loading league…</p>;

  const now = Math.floor(Date.now() / 1000);
  const inWindow = league.status === 'active' && now >= league.start_time && now < league.end_time;
  const myFixtures = (league.fixtures ?? []).filter((f) => myAgentIds.includes(f.initiator));
  const standings = league.standings ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide">LEAGUE #{league.league_id}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {league.entrants.length} players · {league.status === 'active'
              ? <>ends in <span className="text-primary font-semibold">{countdown(league.end_time)}</span></>
              : league.status}
          </p>
        </div>
        <Badge variant="outline" className={cn('uppercase', league.status === 'active' && 'border-primary/50 text-primary')}>
          {league.status}
        </Badge>
      </div>

      <Card className="border-border bg-card/60">
        <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Trophy className="h-4 w-4 text-primary" /> {league.status === 'resolved' ? 'Final standings' : 'Live table'}</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="pb-2">#</th><th className="pb-2">Agent</th>
                <th className="pb-2 text-right">Pts</th><th className="pb-2 text-right">P</th>
                <th className="pb-2 text-right">W</th><th className="pb-2 text-right">L</th>
                <th className="pb-2 text-right">FF</th><th className="pb-2 text-right">HP±</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                <tr key={row.agent} className={cn('border-b border-border/40', row.position <= 3 && 'text-foreground', myAgentIds.includes(row.agent) && 'bg-primary/5')}>
                  <td className={cn('py-2 font-display font-bold', row.position === 1 && 'text-amber-400', row.position === 2 && 'text-slate-300', row.position === 3 && 'text-orange-400')}>{row.position}</td>
                  <td className="py-2">Agent #{row.agent}{myAgentIds.includes(row.agent) && <span className="ml-1.5 text-[10px] text-primary">YOU</span>}</td>
                  <td className="py-2 text-right font-bold text-primary">{row.points}</td>
                  <td className="py-2 text-right">{row.played}</td>
                  <td className="py-2 text-right text-success">{row.wins}</td>
                  <td className="py-2 text-right text-destructive">{row.losses}</td>
                  <td className="py-2 text-right text-muted-foreground">{row.forfeits}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{row.hp_diff > 0 ? '+' : ''}{row.hp_diff.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground">Win 3 · loss 1 · unplayed by deadline 0 · prizes 50/30/20</p>
        </CardContent>
      </Card>

      {connected && myFixtures.length > 0 && (
        <Card className="border-border bg-card/60">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2"><Swords className="h-4 w-4 text-primary" /> Your fixtures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myFixtures.map((f) => (
              <div key={f.index} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-4 py-2.5 text-sm">
                <span>
                  Agent #{f.initiator} <span className="text-muted-foreground">vs</span> Agent #{f.opponent}
                  {f.status === 'played' && (
                    <span className={cn('ml-2 font-semibold', f.winner === f.initiator ? 'text-success' : 'text-destructive')}>
                      {f.winner === f.initiator ? 'WON' : 'LOST'}
                    </span>
                  )}
                  {f.status === 'forfeit' && <span className="ml-2 text-muted-foreground">FORFEITED</span>}
                </span>
                {f.status === 'pending' && inWindow && (
                  <Button size="sm" disabled={playing !== null} onClick={() => play(f)}>
                    {playing === f.index ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Play now'}
                  </Button>
                )}
                {f.status === 'pending' && !inWindow && <span className="text-xs text-muted-foreground">window closed</span>}
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              Opponents don&apos;t need to be online — their agents fight autonomously. They play their reverse fixtures on their own time.
            </p>
          </CardContent>
        </Card>
      )}

      {replay && (
        <Card className="border-border bg-card/60">
          <CardHeader><CardTitle className="font-display text-sm uppercase tracking-widest text-muted-foreground">Fixture replay</CardTitle></CardHeader>
          <CardContent><BattleReplay log={replay} /></CardContent>
        </Card>
      )}
    </div>
  );
}
