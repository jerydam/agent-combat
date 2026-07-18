'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import type { Agent } from '@/lib/types';
import { AgentCard } from '@/components/game/agent-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Wallet, RefreshCw, Star, Flame } from 'lucide-react';
import { toast } from 'sonner';

export function DashboardView() {
  const { address, connected, connect } = useWallet();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (withSync: boolean) => {
    if (!address) return;
    let list = await api.agents(address).catch(() => [] as Agent[]);
    // Empty cache is usually the indexer having missed the mint, not a
    // wallet with no agents — pull straight from the chain and retry.
    if (withSync && list.length === 0) {
      try {
        const r = await api.syncAgents(address);
        if (r.found > 0) list = await api.agents(address);
      } catch { /* chain scan unavailable; show what we have */ }
    }
    setAgents(list);
    api.inventory(address).then((i) => setPoints(i.points)).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!connected) return;
    setAgents(null);
    load(true);
  }, [connected, load]);

  const manualSync = async () => {
    if (!address) return;
    setSyncing(true);
    try {
      const r = await api.syncAgents(address);
      toast.success(r.added > 0 ? `Recovered ${r.added} agent${r.added > 1 ? 's' : ''} from chain` : 'Cache is up to date');
      await load(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Chain sync failed');
    } finally { setSyncing(false); }
  };

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <Wallet className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Connect your wallet to see your agents.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-steel">MY AGENTS</h1>
          <div className="split-line mt-2 w-40" />
          <p className="mt-2 text-sm text-muted-foreground">{agents?.length ?? '—'} / 5 minted</p>
        </div>
        <div className="flex items-center gap-2">
          {points !== null && (
            <div className="split-ring flex items-center gap-1.5 rounded-lg px-3 py-2 font-display text-sm font-bold text-warning">
              <Star className="h-4 w-4" /> {points} pts
            </div>
          )}
          <Button variant="outline" onClick={manualSync} disabled={syncing} title="Re-scan the chain for your mints">
            <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
          <Button asChild variant="outline" className="font-display tracking-wider">
            <Link href="/combat"><Flame className="mr-1.5 h-4 w-4 text-accent" /> FIGHT</Link>
          </Button>
          <Button asChild className="font-display tracking-wider">
            <Link href="/create"><Plus className="mr-1.5 h-4 w-4" /> MINT AGENT</Link>
          </Button>
        </div>
      </div>

      {agents === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-muted-foreground">No agents found for this wallet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Just minted? The chain can take a few seconds —{' '}
            <button onClick={manualSync} className="text-primary underline-offset-2 hover:underline">re-scan now</button>.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.token_id} agent={agent} onClick={() => router.push(`/agents/${agent.token_id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
