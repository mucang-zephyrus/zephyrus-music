import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// 官网部署在 https://mucang.xyz/zephyrus/（nginx 静态兜底），base 必须带子路径
export default defineConfig({
  base: '/zephyrus/',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5273
  },
  build: {
    outDir: 'dist'
  }
});
