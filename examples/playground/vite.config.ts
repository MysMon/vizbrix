import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The playground runs against vizbrix's SOURCE, not a build: each alias points
 * a published subpath at the file tsup bundles for it. Regexes are anchored so
 * `vizbrix/react` cannot shadow `vizbrix/react/static`.
 */
const src = (p: string): string => new URL(`../../src/${p}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^vizbrix\/react\/static$/, replacement: src('react/static.ts') },
      { find: /^vizbrix\/react$/, replacement: src('react/index.ts') },
      { find: /^vizbrix\/charts$/, replacement: src('charts/index.ts') },
      { find: /^vizbrix\/bricks$/, replacement: src('bricks/index.tsx') },
      { find: /^vizbrix\/locales\/ja$/, replacement: src('locales/ja.ts') },
      { find: /^vizbrix\/styles\.css$/, replacement: src('styles.css') },
      { find: /^vizbrix$/, replacement: src('core/index.ts') },
    ],
  },
  server: { port: 5173 },
});
