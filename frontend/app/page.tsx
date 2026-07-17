'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { LandingView } from '@/components/game/views/landing';

export default function Home() {
  const { connected } = useWallet();
  const router = useRouter();

  // If already connected, send to dashboard
  useEffect(() => {
    if (connected) router.replace('/dashboard');
  }, [connected, router]);

  return <LandingView onEnter={() => router.push('/dashboard')} />;
}
