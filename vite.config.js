import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Target older browsers (Chrome 80+, Firefox 80+, Safari 13+, Edge 80+)
    // This ensures CSS and JS are transpiled for compatibility with Windows 
    // users on older Chrome/Edge/Firefox and macOS Safari users.
    target: ['es2020', 'chrome80', 'firefox80', 'safari13', 'edge80'],
    // Generate CSS that works across these browsers
    cssTarget: ['chrome80', 'firefox80', 'safari13', 'edge80'],
  },
  css: {
    // PostCSS handles autoprefixer via postcss.config.js
  },
});
