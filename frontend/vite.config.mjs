import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/teaching-cpp/',
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: { '/api/cpp': 'http://127.0.0.1:5100' } },
  build: { outDir: 'dist', sourcemap: false, rollupOptions: { output: { manualChunks: { editor: ['@uiw/react-codemirror', '@codemirror/lang-cpp', '@codemirror/view', '@codemirror/state'] } } } }
});
