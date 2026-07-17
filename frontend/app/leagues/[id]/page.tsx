'use client';

import { LeagueRoomView } from '@/components/game/views/league-room';

export default function LeagueRoomPage({ params }: { params: { id: string } }) {
  return <LeagueRoomView leagueId={Number(params.id)} />;
}
