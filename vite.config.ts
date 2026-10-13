import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    // permite medir o jogo com o perfilador de JavaScript do navegador (só no servidor de desenvolvimento)
    headers: { 'Document-Policy': 'js-profiling' }
  },
  build: {
    target: 'esnext'
  }
});
