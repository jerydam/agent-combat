'use client';

import { CombatView } from '@/components/game/views/combat';

/**
 * Live player-vs-player. Same immersive combat screen as /combat, so it
 * is listed in NavShell's GAME_SCREENS and runs in landscape.
 */
export default function PvpPage() {
  return <CombatView pvp />;
}
