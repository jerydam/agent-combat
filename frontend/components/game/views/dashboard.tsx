'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import type { Agent } from '@/lib/types';
import { AgentCard } from '@/components/game/agent-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Wallet } from 'lucide-react';

export function DashboardView() {
  const { address, connected, connect } = useWallet();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    api.agents(address).then((a) => live && setAgents(a)).catch(() => live && setAgents([]));
    return () => { live = false; };
  }, [connected, address]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide">MY AGENTS</h1>
          <p className="mt-1 text-sm text-muted-foreground">{agents?.length ?? '—'} / 5 minted</p>
        </div>
        <Button asChild className="font-display tracking-wider">
          <Link href="/create"><Plus className="mr-1.5 h-4 w-4" /> MINT AGENT</Link>
        </Button>
      </div>

      {agents === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-20 text-center text-muted-foreground">
          No agents yet — mint your first fighter.
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
