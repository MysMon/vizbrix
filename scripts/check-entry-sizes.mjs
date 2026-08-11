#!/usr/bin/env node
/**
 * Gates each published entry point against a gzip size budget.
 *
 * Sizes are measured the way a bundler sees them: dist output, bundled,
 * minified, React externalized, gzipped. Budgets are the measured sizes plus
 * ~10% headroom — an increase past that must be a deliberate decision (raise
 * the budget in this file inside the same PR and say why), never an accident.
 *
 * esbuild is invoked via `pnpm exec` (the pinned devDependency), not `npx`,
 * so the measurement is reproducible offline and isn't silently retaken by
 * whatever `esbuild@latest` happens to resolve to on a given day.
 */
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import process from 'node:process';

const BUDGETS_KB = {
  index: 35.6,
  'react/index': 36.3,
  'react/view': 20.0,
  'react/static': 4.9,
  schema: 10.3,
  'locales/ja': 1.1,
};

let failed = false;
for (const [entry, budgetKb] of Object.entries(BUDGETS_KB)) {
  const bundled = execFileSync(
    'pnpm',
    [
      'exec', 'esbuild', `dist/${entry}.js`, '--bundle', '--minify', '--format=esm',
      '--external:react', '--external:react-dom', '--external:react/jsx-runtime',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const kb = gzipSync(bundled, { level: 9 }).length / 1024;
  const over = kb > budgetKb;
  if (over) failed = true;
  console.log(
    `${over ? 'FAIL' : ' ok '} ${entry.padEnd(14)} ${kb.toFixed(1).padStart(6)} KB gzip` +
    ` (budget ${budgetKb.toFixed(1)} KB)`,
  );
}

if (failed) {
  console.error('\nAn entry exceeded its size budget. If the increase is intentional,');
  console.error('raise the budget in scripts/check-entry-sizes.mjs in the same PR and justify it.');
  process.exit(1);
}
