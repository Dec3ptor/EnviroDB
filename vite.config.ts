import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { withCsp } from './src/security/csp';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// The build: its commit (GitHub Actions says; otherwise git) and date
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
})();
const build = { commit, date: new Date().toISOString().slice(0, 10) };

// Relative base so the build works at https://<user>.github.io/<repo>/ (or any sub-path)
// without hard-coding the repository name. Routing is hash-based for the same reason.
export default defineConfig({
  base: './',
  // the built page carries its Content Security Policy (src/security/csp.ts): it may contact nothing but its own
  // address and the map services
  plugins: [
    react(),
    { name: 'content-security-policy', apply: 'build', transformIndexHtml: (html: string) => withCsp(html) },
    // version.json next to the app: an open copy of EnviroDB checks it to offer reloading when a new version is out
    {
      name: 'version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, ...build }) });
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build) },
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
