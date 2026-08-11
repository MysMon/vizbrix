#!/usr/bin/env node
/**
 * Packaging smoke test.
 *
 * `pnpm build` and the size check both read dist/ directly, so neither one
 * would notice a broken `exports` map, a typo'd dist path, or a subpath that
 * only resolves under `moduleResolution: bundler` but not through Node's
 * actual resolver. This script packs the real tarball (the artifact `npm
 * publish` would upload), installs it into a scratch project exactly the way
 * a consumer would, and resolves every published subpath through Node's own
 * ESM and CJS loaders. If this passes, the package is installable and
 * importable as shipped — not just buildable.
 *
 * Dependency-free by design (only node:child_process, node:fs, node:os,
 * node:path) so it never needs its own install step.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

/** Subpath -> a value export that only exists if the real module loaded. */
const ENTRIES = {
  vizbrix: 'SCHEMA_VERSION',
  'vizbrix/schema': 'validate',
  'vizbrix/react': 'Vizbrix',
  'vizbrix/react/view': 'VizbrixView',
  'vizbrix/react/static': 'VizbrixStatic',
  'vizbrix/locales/ja': 'ja',
};

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

function esmProbe() {
  const checks = Object.entries(ENTRIES)
    .map(([spec, symbol]) => `
  {
    const m = await import(${JSON.stringify(spec)});
    if (!(${JSON.stringify(symbol)} in m)) {
      throw new Error(${JSON.stringify(`ESM: ${spec} is missing expected export "${symbol}"`)});
    }
  }`)
    .join('\n');
  return `(async () => {${checks}\n  console.log('esm ok');\n})().catch((err) => { console.error(err); process.exit(1); });\n`;
}

function cjsProbe() {
  const checks = Object.entries(ENTRIES)
    .map(([spec, symbol]) => `
  {
    const m = require(${JSON.stringify(spec)});
    if (!(${JSON.stringify(symbol)} in m)) {
      throw new Error(${JSON.stringify(`CJS: ${spec} is missing expected export "${symbol}"`)});
    }
  }`)
    .join('\n');
  return `try {${checks}\n  console.log('cjs ok');\n} catch (err) { console.error(err); process.exit(1); }\n`;
}

let workDir;
let exitCode = 0;
try {
  workDir = mkdtempSync(join(tmpdir(), 'vizbrix-smoke-'));
  const packDir = join(workDir, 'pack');
  const consumerDir = join(workDir, 'consumer');

  console.log(`[smoke-pack] packing tarball into ${packDir}`);
  run('pnpm', ['pack', '--pack-destination', packDir], { cwd: repoRoot });
  const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('pnpm pack did not produce a .tgz file');
  const tarballPath = join(packDir, tarball);
  console.log(`[smoke-pack] tarball: ${tarball}`);

  console.log(`[smoke-pack] installing into fresh project at ${consumerDir}`);
  execFileSync('mkdir', ['-p', consumerDir]);
  run('npm', ['init', '-y'], { cwd: consumerDir });
  run('npm', ['install', tarballPath, 'react', 'react-dom'], { cwd: consumerDir });

  const esmFile = join(consumerDir, 'smoke.mjs');
  const cjsFile = join(consumerDir, 'smoke.cjs');
  writeFileSync(esmFile, esmProbe());
  writeFileSync(cjsFile, cjsProbe());

  console.log('[smoke-pack] resolving every subpath export via ESM import()');
  console.log(run('node', [esmFile], { cwd: consumerDir }).trim());

  console.log('[smoke-pack] resolving every subpath export via CJS require()');
  console.log(run('node', [cjsFile], { cwd: consumerDir }).trim());

  console.log('[smoke-pack] all subpaths resolved in both module systems');
} catch (err) {
  exitCode = 1;
  if (err.stdout) process.stderr.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  console.error(`[smoke-pack] FAILED: ${err.message}`);
} finally {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
}

process.exit(exitCode);
