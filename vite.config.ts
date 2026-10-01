import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Режимы сборки:
//   build        — демо для GitHub Pages (данные в браузере)            → dist
//   build:single — демо одним HTML-файлом                               → dist-single
//   build:api    — фронтенд для сервера (VITE_API=1 из .env.api)        → dist-api (раздаёт NestJS)
const outDir: Record<string, string> = { single: 'dist-single', api: 'dist-api' };

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: outDir[mode] || 'dist', chunkSizeWarningLimit: 5000 },
  // dev:api — запросы /api проксируются на бэкенд, браузер не обращается к localhost напрямую
  server: { host: '0.0.0.0', allowedHosts: true, proxy: { '/api': 'http://localhost:3000' } },
  preview: { host: '0.0.0.0', allowedHosts: true },
}));
