'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, waitForBattle } from '@/lib/api';
import type { Battle, BattleLog } from '@/lib/types';
import { BattleReplay } from '@/components/game/battle-replay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ExternalLink } from 'lucide-react';

export function BattleView() {
  const params = useSearchParams();
  const id = Number(params.get('id') ?? 0);
  const [battle, setBattle] = useState<Battle | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let live = true;
    waitForBattle(id)
      .then((b) => live && setBattle(b))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  if (!id) return <p className="py-24 text-center text-muted-foreground">No battle selected.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold tracking-wide">BATTLE #{id}</h1>
        {battle?.tx_hash && (
          <a
            href={`https://scan.botchain.ai/tx/${battle.tx_hash.startsWith('0x') ? battle.tx_hash : `0x${battle.tx_hash}`}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            On-chain result <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {!battle && !error && (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p>Agents are fighting on BOT Chain… (resolves in seconds)</p>
        </div>
      )}

      {error && (
        <Card className="border-border bg-card/60">
          <CardContent className="space-y-3 py-8 text-center text-sm text-muted-foreground">
            <p>{error}</p>
            <Button variant="outline" onClick={() => location.reload()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {battle && battle.moves && 'rounds' in battle.moves && (
        <Card className="border-border bg-card/60">
          <CardHeader>
            <CardTitle className="font-display text-sm uppercase tracking-widest text-muted-foreground">
              Verified replay · seed-deterministic · hash {battle.moves_hash.slice(0, 14)}…
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BattleReplay log={battle.moves as BattleLog} />
          </CardContent>
        </Card>
      )}

      <div className="text-center">
        <Button asChild variant="outline"><Link href="/arena">Back to arena</Link></Button>
      </div>
    </div>
  );
}
