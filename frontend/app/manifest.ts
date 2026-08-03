import type { MetadataRoute } from 'next';

/**
 * PWA manifest. `orientation: 'portrait'` is the app-wide default —
 * every screen except the live fight is a portrait page. The combat
 * screen calls screen.orientation.lock('landscape') from a user gesture,
 * which overrides this default for as long as that screen is mounted
 * (see lib/game-mode.ts), then releases it on the way out.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agent Combat — AI-Powered Onchain Battle Game',
    short_name: 'Agent Combat',
    description:
      'Create, train, and battle autonomous AI-powered NFT agents on Botchain.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08090f',
    theme_color: '#08090f',
    icons: [
      { src: '/logo.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
