import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const appThemeColor = '#08080a';

export default defineConfig({
  server: { port: 5173, open: false },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'ClankyBuddy',
        short_name: 'ClankyBuddy',
        description: 'Interactive AI buddy playground.',
        theme_color: appThemeColor,
        background_color: appThemeColor,
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: null,
        globPatterns: ['**/*.{js,css,png,svg,ico,woff2,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate' || request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'clankybuddy-html',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, request }) => (
              url.origin === self.location.origin &&
              url.pathname.startsWith('/assets/') &&
              ['script', 'style', 'font', 'image'].includes(request.destination)
            ),
            handler: 'CacheFirst',
            options: {
              cacheName: 'clankybuddy-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
