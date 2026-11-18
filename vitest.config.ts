import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `src/bricks` imports the charts through the package's own subpath (that
    // import is the client boundary in the build); point it at the source here.
    alias: [{ find: /^vizbrix\/charts$/, replacement: new URL('./src/charts/index.ts', import.meta.url).pathname }],
  },
  test: {
    // Core tests run in node; DOM tests opt into jsdom with a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.*', 'src/**/types.ts'],
    },
  },
});
