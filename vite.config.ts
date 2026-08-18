import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['**/*.{js,css,html,json,wasm}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/huggingface\.co\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'hf-model-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            {
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'jsdelivr-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
          ],
          // embeddings.json 可能超過 Workbox 預設的 2MB 快取上限
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
        manifest: {
          name: 'PDPC 個資法函釋查詢助理',
          short_name: 'PDPC 函釋',
          description: '個人資料保護法官方函釋語意搜尋，純前端、離線可用',
          theme_color: '#0f172a',
          background_color: '#f1f5f9',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          // C5 fix: 使用 SVG（sizes:'any'），避免需維護多個 PNG 尺寸
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
      }),
    ],
    optimizeDeps: {
      exclude: ['@xenova/transformers'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
