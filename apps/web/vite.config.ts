import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

// `vite build --mode demo` produces one self-contained HTML file that runs the full platform
// in the browser (in-memory data store + the same core services the API uses).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  resolve: { alias: { '@retailgeo/core': path.resolve(__dirname, '../../packages/core/src/index.ts') } },
  define: { __DEMO_BUILD__: JSON.stringify(mode === 'demo') },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', sourcemap: mode !== 'demo', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
}));
