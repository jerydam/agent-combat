'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { ArenaView } from '@/components/game/views/arena';

export default function ArenaPage() {
  const { connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!connected) router.replace('/');
  }, [connected, router]);

  if (!connected) return null;
  return <ArenaView />;
}
