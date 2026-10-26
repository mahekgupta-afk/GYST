import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Lets tests import components (which use the "@/" alias and JSX) so rendered output can be checked.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { environment: 'node' },
});
