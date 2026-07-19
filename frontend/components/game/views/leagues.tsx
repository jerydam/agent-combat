'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keccak256, parseEther, toBytes } from 'viem';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import { writeContract } from '@/lib/tx';
import { ADDRESSES, LEAGUE_ABI } from '@/lib/contracts';
import type { Agent, LeagueInfo } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Users, Plus, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const ZERO_HASH = `0x${'0'.repeat(64)}` as const;

function fmtTime(unix: number) {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function LeaguesView() {
  const { address, connected, connect } = useWallet();
  const [leagues, setLeagues] = useState<LeagueInfo[]>([]);
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState(false);

  // create form
  const [fee, setFee] = useState('0');
  const [maxPlayers, setMaxPlayers] = useState('8');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [code, setCode] = useState('');

  // join form
  const [joinId, setJoinId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinFee, setJoinFee] = useState('0');
  const [joinAgent, setJoinAgent] = useState('');

  useEffect(() => {
    api.leagues().then(setLeagues).catch(() => {});
  }, []);
  useEffect(() => {
    if (!connected) return;
    api.agents(address).then(setMyAgents).catch(() => {});
  }, [connected, address]);

  async function createLeague() {
    if (!connected) return connect();
    const startTs = Math.floor(new Date(start).getTime() / 1000);
    const endTs = Math.floor(new Date(end).getTime() / 1000);
    if (!startTs || !endTs || endTs <= startTs || startTs <= Date.now() / 1000) {
      return toast.error('Pick a future start time and an end time after it');
    }
    setBusy(true);
    try {
      await writeContract({
        address: ADDRESSES.league,
        abi: LEAGUE_ABI as any,
        functionName: 'createLeague',
        args: [
          parseEther(fee || '0'),
          Number(maxPlayers),
          BigInt(startTs),
          BigInt(endTs),
          code.trim() ? keccak256(toBytes(code.trim())) : ZERO_HASH,
        ],
        account: address as `0x${string}`,
      });
      toast.success(code.trim()
        ? `League room created — share the code "${code.trim()}" with your players`
        : 'Public league room created');
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function joinLeague() {
    if (!connected) return connect();
    if (!joinId || !joinAgent) return toast.error('League ID and agent required');
    setBusy(true);
    try {
      await writeContract({
        address: ADDRESSES.league,
        abi: LEAGUE_ABI as any,
        functionName: 'join',
        args: [BigInt(joinId), joinCode, BigInt(joinAgent)],
        value: parseEther(joinFee || '0'),
        account: address as `0x${string}`,
      });
      toast.success(`Joined league #${joinId} — come back after it starts to play your fixtures`);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? 'Join failed — check the ID, code, and entry fee');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide text-steel">LEAGUES</h1>
          <div className="split-line mt-2 w-32" />
        <p className="mt-1 text-sm text-muted-foreground">
          Room-based, scheduled, async. Play your fixtures whenever you&apos;re online — your opponents&apos; agents fight autonomously. Unplayed fixtures forfeit at the deadline.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-border bg-card/60">
          <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /> Create a room</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Entry fee (BOT)</label>
              <Input value={fee} onChange={(e) => setFee(e.target.value)} className="bg-background/60" /></div>
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Max players</label>
              <Input value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} className="bg-background/60" /></div>
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Starts</label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="bg-background/60" /></div>
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Ends</label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="bg-background/60" /></div>
            <div className="col-span-2 space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Join code (blank = public)</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="secret-room-42" className="bg-background/60" /></div>
            <Button onClick={createLeague} disabled={busy} className="col-span-2 font-display tracking-wider">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />} CREATE LEAGUE
            </Button>
            <p className="col-span-2 text-center text-[11px] text-muted-foreground">
              Prize split 50/30/20 · minimum 3 players · code is a social gate, not cryptographic secrecy
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/60">
          <CardHeader><CardTitle className="font-display text-lg flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Join with code</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">League ID</label>
              <Input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="1" className="bg-background/60" /></div>
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Code (if private)</label>
              <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className="bg-background/60" /></div>
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Entry fee (BOT)</label>
              <Input value={joinFee} onChange={(e) => setJoinFee(e.target.value)} className="bg-background/60" /></div>
            <div className="space-y-1"><label className="text-xs uppercase tracking-wider text-muted-foreground">Your agent</label>
              <Select value={joinAgent} onValueChange={setJoinAgent}>
                <SelectTrigger className="bg-background/60"><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  {myAgents.map((a) => (
                    <SelectItem key={a.token_id} value={String(a.token_id)}>{a.name} (#{a.token_id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={joinLeague} disabled={busy} className="col-span-2 font-display tracking-wider">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />} JOIN ROOM
            </Button>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Active & recent leagues</h2>
        <div className="space-y-2">
          {leagues.map((l) => (
            <Link key={l.league_id} href={`/leagues/${l.league_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/50 px-4 py-3 transition-colors hover:border-primary/50">
              <div>
                <span className="font-display font-bold">League #{l.league_id}</span>{' '}
                <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] uppercase ${l.status === 'active' ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}>{l.status}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {l.entrants.length} players · {fmtTime(l.start_time)} → {fmtTime(l.end_time)}
              </div>
            </Link>
          ))}
          {leagues.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No leagues yet — leagues appear here once activated on-chain.</p>}
        </div>
      </section>
    </div>
  );
}