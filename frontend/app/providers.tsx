'use client';

import { WalletProvider } from '@/lib/wallet';
import { NavShell } from '@/components/game/nav-shell';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <NavShell>{children}</NavShell>
    </WalletProvider>
  );
}
