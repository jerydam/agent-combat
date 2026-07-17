import './globals.css';
import type { Metadata } from 'next';
import { Orbitron, Rajdhani } from 'next/font/google';
import { Providers } from './providers';

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://agent-arena.botchain.xyz'),
  title: 'Agent Arena — AI-Powered Onchain Battle Game',
  description:
    'Create, train, and battle autonomous AI-powered NFT agents on Botchain. A Pokémon-style AI battle ecosystem where agents learn, evolve, and compete.',
  openGraph: {
    title: 'Agent Arena',
    description:
      'Create, train, and battle autonomous AI-powered NFT agents on Botchain.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${orbitron.variable} ${rajdhani.variable} font-body antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
