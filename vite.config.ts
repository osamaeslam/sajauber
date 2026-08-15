import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import fs from 'fs';
import {VitePWA} from 'vite-plugin-pwa';

// Load ORS key from .env for the dev proxy (avoids browser CORS issues)
const envRaw = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
const orsKeyMatch = envRaw.split('\n').find(l => l.startsWith('VITE_ORS_API_KEY='));
const ORS_KEY = orsKeyMatch ? orsKeyMatch.split('=')[1].trim() : '';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['ezz_taxi_icon.jpg', 'favicon.ico'],
        manifest: './public/manifest.json',
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-maps': ['lucide-react'],
            'vendor-utils': ['motion'],
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api/ors': {
          target: 'https://api.openrouteservice.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/ors/, ''),
          headers: {
            Authorization: ORS_KEY,
          },
        },
      },
    },
  };
});
