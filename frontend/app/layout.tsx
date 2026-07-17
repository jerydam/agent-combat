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
      <head>
        <meta name="talentapp:project_verification" content="2aa7a19b3e43e2a67c598c51b4b5eb4275726462455b8d3e711fd89a5e47506cfde0bb7de2083ecb2bcb824610e6c656879a473151afb30e0983f67c2619fa34"></meta>
      </head>
      <body
        className={`${orbitron.variable} ${rajdhani.variable} font-body antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
