import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// GitHub Pages project site: https://igel7.github.io/network-portfolio/
// Override with VITE_BASE=/ for local preview at the root if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/network-portfolio/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo.html'),
        about: resolve(__dirname, 'about.html'),
      },
    },
  },
});
