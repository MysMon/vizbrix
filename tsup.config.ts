import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2022' as const,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
};

export default defineConfig([
  // Server-safe entries: no "use client" banner. react/static must stay a
  // genuine React Server Component entry, so it lives in this group.
  {
    ...shared,
    clean: true,
    entry: {
      index: 'src/core/index.ts',
      schema: 'src/schema.ts',
      'locales/ja': 'src/core/locales/ja.ts',
      'react/static': 'src/react/static.ts',
    },
  },
  // Client entries: interaction/hooks — banner required for RSC bundlers.
  {
    ...shared,
    entry: {
      'react/index': 'src/react/index.ts',
      'react/view': 'src/react/view.ts',
    },
    banner: { js: '"use client";' },
  },
]);
