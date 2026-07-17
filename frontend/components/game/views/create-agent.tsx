'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import { writeContract, eventArgs } from '@/lib/tx';
import { ADDRESSES, AGENT_NFT_ABI } from '@/lib/contracts';
import { PERSONALITY_NAMES, type PersonalityId } from '@/lib/types';
import { AgentAvatar } from '@/components/game/agent-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const PERSONALITY_INFO: Record<PersonalityId, { desc: string; bonus: string }> = {
  0: { desc: 'High tempo. Power-strikes relentlessly, hunts finishers.', bonus: '+10 ATK at mint' },
  1: { desc: 'Guards, regenerates energy, outlasts and punishes.', bonus: '+10 DEF at mint' },
  2: { desc: 'Stacks focus early, reads opponents, strikes at the right moment.', bonus: '+10 INT at mint' },
};

export function CreateAgentView() {
  const { address, connected, connect } = useWallet();
  const router = useRouter();
  const [name, setName] = useState('');
  const [personality, setPersonality] = useState<PersonalityId>(0);
  const [minting, setMinting] = useState(false);

  async function mint() {
    if (!connected) return connect();
    if (!name.trim() || name.length > 32) {
      toast.error('Name must be 1–32 characters');
      return;
    }
    setMinting(true);
    try {
      const receipt = await writeContract({
        address: ADDRESSES.agentNFT,
        abi: AGENT_NFT_ABI as any,
        functionName: 'mintAgent',
        args: [name.trim(), personality],
        account: address as `0x${string}`,
      });
      const minted = eventArgs<{ tokenId: bigint }>(receipt, AGENT_NFT_ABI as any, 'AgentMinted');
      toast.success('Agent minted — stats rolled on-chain!');
      // give the indexer a beat, then land on the roster
      await new Promise((r) => setTimeout(r, 2500));
      await api.agents(address).catch(() => {});
      router.push(minted ? `/agents/${minted.tokenId}` : '/dashboard');
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? 'Mint failed');
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">MINT AGENT</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stats roll on-chain at mint (40–90 per stat) — the personality you pick shapes how your agent fights forever.
        </p>
      </div>

      <Card className="border-border bg-card/60">
        <CardHeader>
          <CardTitle className="font-display text-lg">Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <AgentAvatar personality={personality} tier={1} name={name || 'New Agent'} size="lg" animate={minting} />
            <div className="flex-1 space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Agent name</label>
              <Input
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cyber Blob"
                className="bg-background/60"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Personality (permanent)</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {([0, 1, 2] as PersonalityId[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPersonality(p)}
                  className={cn(
                    'rounded-xl border bg-background/40 p-4 text-left transition-all',
                    personality === p
                      ? 'border-primary ring-2 ring-primary/40 shadow-[0_0_20px_rgba(20,184,166,0.2)]'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <div className="font-display font-bold">{PERSONALITY_NAMES[p]}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{PERSONALITY_INFO[p].desc}</p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-primary">{PERSONALITY_INFO[p].bonus}</p>
                </button>
              ))}
            </div>
          </div>

          <Button onClick={mint} disabled={minting} className="w-full font-display tracking-wider" size="lg">
            {minting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> MINTING ON BOT CHAIN…</>
            ) : connected ? (
              <><Sparkles className="mr-2 h-4 w-4" /> MINT AGENT</>
            ) : (
              'CONNECT WALLET TO MINT'
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Max 5 agents per wallet · gas paid in BOT
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
