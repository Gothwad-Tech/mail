import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  // Read VITE_* values from .env files (see .env.example). loadEnv is needed because
  // Vite only puts VITE_* values into import.meta.env for browser code, not into this config.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    // Deep links like /u/1/#sent are the canonical app URL: the dev server must
    // answer them with index.html, exactly like the Pages rewrite in public/_redirects.
    appType: 'spa',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'icon-192.png',
          'icon-512.png',
          'icon-192-maskable.png',
          'icon-512-maskable.png',
        ],
        // One manifest only: public/manifest.json. The plugin's own generator
        // would emit a second, differently-iconed copy at /manifest.webmanifest
        // while index.html links /manifest.json — two sources of truth for the
        // same install prompt.
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // The app shell works offline; /api/* always goes to the network,
          // because mail bodies are private and must never be cached in the SW.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // Google Fonts: served from cache after the first visit, refreshed
              // quietly in the background (no blank text, no repeat download).
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Icons and images from the app's own bundle.
              urlPattern: /\.(?:png|jpg|jpeg|svg|ico|webp)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-images',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // Dev only: /api goes to the local Mail Worker (`npm run worker:dev`).
      // The browser keeps calling same-origin /api, just like production.
      // The target is a server-side setting, so 127.0.0.1 never reaches the browser.
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787',
          changeOrigin: false,
        },
        // The shared account widget is served by Accounts in production. Locally
        // the dev server stands in for it on the same path, so the browser loads
        // it from this origin and the loader's same-origin rule applies.
        '/widget': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787',
          changeOrigin: false,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
