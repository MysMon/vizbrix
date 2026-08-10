import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Core tests run in node; adapter tests opt into jsdom with a
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
