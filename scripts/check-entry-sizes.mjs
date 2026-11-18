// Bundles each published entry on its own (react external), minifies, gzips,
// and fails if any exceeds its budget. Run after `pnpm build`.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const budgets = {
  'dist/index.js': 14,
  'dist/react/index.js': 20,
  'dist/react/static.js': 4,
  'dist/charts/index.js': 18,
  'dist/bricks/index.js': 5,
  'dist/locales/ja.js': 3,
};

let failed = false;
for (const [entry, budget] of Object.entries(budgets)) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'vizbrix/charts'],
  });
  const kb = gzipSync(result.outputFiles[0].contents).length / 1024;
  const ok = kb <= budget;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${entry.padEnd(24)} ${kb.toFixed(1).padStart(6)} KB gzip (budget ${budget} KB)`);
}
const css = gzipSync(readFileSync('dist/styles.css')).length / 1024;
console.log(`     ${'dist/styles.css'.padEnd(24)} ${css.toFixed(1).padStart(6)} KB gzip`);
process.exit(failed ? 1 : 0);
