'use client';

import { AgentDetailView } from '@/components/game/views/agent-detail';

export default function AgentDetailPage({ params }: { params: { id: string } }) {
  return <AgentDetailView tokenId={Number(params.id)} />;
}
