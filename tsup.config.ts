import { copyFileSync } from 'node:fs';
import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'vizbrix/charts'],
};

export default defineConfig([
  // Server-safe entries: no "use client" banner. `react/static` and `bricks`
  // must stay importable from React Server Components. `bricks` reaches the
  // interactive components through the package's own `vizbrix/charts` export
  // (kept external above), which is where the client boundary sits.
  {
    ...shared,
    clean: true,
    entry: {
      index: 'src/core/index.ts',
      'locales/ja': 'src/locales/ja.ts',
      'react/static': 'src/react/static.ts',
      'bricks/index': 'src/bricks/index.tsx',
    },
    onSuccess: async () => copyFileSync('src/styles.css', 'dist/styles.css'),
  },
  // Client entries: hooks and event handlers.
  {
    ...shared,
    entry: {
      'react/index': 'src/react/index.ts',
      'charts/index': 'src/charts/index.ts',
    },
    banner: { js: '"use client";' },
  },
]);
