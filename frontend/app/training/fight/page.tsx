'use client';

import { CombatView } from '@/components/game/views/combat';

/**
 * The live training fight. Its own route (rather than a mode toggled on
 * /training) so NavShell can treat it as an immersive game screen — same
 * landscape lock and chrome-free layout as /combat, because it IS the
 * combat screen. The portrait /training page stays a normal page.
 */
export default function TrainingFightPage() {
  return <CombatView tutorial />;
}
