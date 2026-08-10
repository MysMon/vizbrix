import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The playground runs against vizbrix's SOURCE, not a published build — these
 * aliases point each subpath entry at the exact file tsup would otherwise
 * bundle (see package.json "exports" at the repo root). That keeps the demo
 * honest: if an import here breaks, the real entry point broke.
 *
 * Ordered most-specific-first and anchored with `^…$` so `vizbrix/react`
 * can never shadow `vizbrix/react/view` (Vite's alias matching is
 * prefix-based for plain string keys). Resolved via `URL(...).pathname`
 * rather than `node:url`'s `fileURLToPath` so this file needs no `@types/node`.
 */
const src = (p: string): string => new URL(`../../src/${p}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^vizbrix\/react\/view$/, replacement: src('react/view.ts') },
      { find: /^vizbrix\/react\/static$/, replacement: src('react/static.ts') },
      { find: /^vizbrix\/react$/, replacement: src('react/index.ts') },
      { find: /^vizbrix\/locales\/ja$/, replacement: src('core/locales/ja.ts') },
      { find: /^vizbrix\/schema$/, replacement: src('schema.ts') },
      { find: /^vizbrix$/, replacement: src('core/index.ts') },
    ],
  },
  server: {
    port: 5173,
  },
});
