import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Lets tests import components (which use the "@/" alias and JSX) so rendered output can be checked.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname) } },
  // The page renders many sections now and some tests drive the whole app, so allow more than the default 5 s on a busy machine.
  test: { environment: 'node', testTimeout: 20000 },
});
