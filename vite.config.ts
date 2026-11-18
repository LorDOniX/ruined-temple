import { defineConfig } from 'vite';

// Game installs / texture mods may live in the project folder - keep Vite from scanning or watching them.
const ignored = ['**/Warcraft III*/**', '**/Classic HD*/**', '**/node_modules/**'];

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5199, strictPort: true, watch: { ignored } },
  optimizeDeps: {
    entries: ['index.html'],
    include: ['three', 'three/examples/jsm/utils/SkeletonUtils.js', 'mdx-m3-viewer/dist/cjs/parsers/mdlx/model', 'mdx-m3-viewer/dist/cjs/parsers/blp/image'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
