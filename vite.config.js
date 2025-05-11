import { defineConfig } from 'vite';

export default defineConfig({
  // Enable React JSX transformation
  esbuild: {
    jsxInject: `import React from 'react'`,
  },
  // Base path for production build (adjust if needed)
  base: './',
  // Configure the build
  build: {
    outDir: 'dist',
    // Enable source maps for debugging
    sourcemap: true,
  },
  // Optimize dependencies 
  optimizeDeps: {
    include: ['react', 'react-dom', 'd3', 'use-local-storage-state', 'uuid'],
  },
  // Use ESM for all outputs
  server: {
    // Use open flag to automatically open browser
    open: true,
  }
});
