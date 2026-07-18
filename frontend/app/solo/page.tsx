import { redirect } from 'next/navigation';

// Solo merged into Combat: same real-time fight, optional stake.
export default function SoloPage() {
  redirect('/combat');
}
