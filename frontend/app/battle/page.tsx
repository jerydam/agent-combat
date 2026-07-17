'use client';

import { Suspense } from 'react';
import { BattleView } from '@/components/game/views/battle';

export default function BattlePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-muted-foreground">Loading battle…</div>}>
      <BattleView />
    </Suspense>
  );
}
