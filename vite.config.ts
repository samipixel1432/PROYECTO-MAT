import { defineConfig } from 'vite';

// Proyecto Vite estándar: Vercel lo detecta solo (build: `npm run build`, salida: `dist`).
export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
