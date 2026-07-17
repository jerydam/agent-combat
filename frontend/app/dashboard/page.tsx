'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { DashboardView } from '@/components/game/views/dashboard';

export default function DashboardPage() {
  const { connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!connected) router.replace('/');
  }, [connected, router]);

  if (!connected) return null;
  return <DashboardView />;
}
