import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * base 使用相对路径：同一份 dist 既可由 vite preview 托管，
 * 也可被 Electron 以 file:// 加载（Electron 场景需配合 HashRouter）。
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Vite 8（Rolldown）只接受函数形式的 manualChunks
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('@tanstack') || id.includes('zustand')) return 'query';
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom')) return 'react';
          return undefined;
        },
      },
    },
  },
});
