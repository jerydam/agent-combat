'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { TrainingView } from '@/components/game/views/training';

export default function TrainingPage() {
  const { connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!connected) router.replace('/');
  }, [connected, router]);

  if (!connected) return null;
  return <TrainingView />;
}
