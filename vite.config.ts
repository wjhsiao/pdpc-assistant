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
        // manifest 關閉自動產生/注入：/ 和 /ai 需要各自獨立的 manifest
        // （不同 name/icon/start_url），才能在手機分別加入主畫面成兩個獨立捷徑。
        // 改成手寫兩份靜態檔（public/manifest.webmanifest、
        // public/manifest-ai.webmanifest），各自的 html 手動 <link> 過去。
        manifest: false,
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
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          ai: path.resolve(__dirname, 'ai.html'),
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
