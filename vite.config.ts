import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { withCsp } from './src/security/csp';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Relative base so the build works at https://<user>.github.io/<repo>/ (or any sub-path)
// without hard-coding the repository name. Routing is hash-based for the same reason.
export default defineConfig({
  base: './',
  // the built page carries its Content Security Policy (src/security/csp.ts): it may contact nothing but its own
  // address and the map services
  plugins: [react(), { name: 'content-security-policy', apply: 'build', transformIndexHtml: (html: string) => withCsp(html) }],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/dates', '@mantine/notifications', '@mantine/modals', '@mantine/dropzone'],
          echarts: ['echarts'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
