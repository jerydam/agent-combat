'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { CreateAgentView } from '@/components/game/views/create-agent';

export default function CreatePage() {
  const { connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!connected) router.replace('/');
  }, [connected, router]);

  if (!connected) return null;
  return <CreateAgentView />;
}
