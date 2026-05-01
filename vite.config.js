import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'Candidatic IA',
        short_name: 'Candidatic',
        description: 'Plataforma de reclutamiento inteligente',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // Cache static assets and limit sizes
        maximumFileSizeToCacheInBytes: 5000000,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    // Target older browsers (Chrome 80+, Firefox 80+, Safari 13+, Edge 80+)
    // This ensures CSS and JS are transpiled for compatibility with Windows 
    // users on older Chrome/Edge/Firefox and macOS Safari users.
    target: ['es2020', 'chrome80', 'firefox80', 'safari13', 'edge80'],
    // Generate CSS that works across these browsers
    cssTarget: ['chrome80', 'firefox80', 'safari13', 'edge80'],
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks — cached forever, never change
          'vendor-react': ['react', 'react-dom'],
          'vendor-emoji': ['emoji-picker-react'],
          'vendor-virtuoso': ['react-virtuoso'],
          'vendor-icons': ['lucide-react'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        }
      }
    }
  },
  css: {
    // PostCSS handles autoprefixer via postcss.config.js
  },
});
