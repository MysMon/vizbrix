// Packs the library, installs the tarball into a scratch project next to
// react, and checks that every published subpath resolves and works under
// both ESM and CJS — including that server-safe entries carry no
// "use client" banner and client entries do. Run after `pnpm build`.
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'vizbrix-smoke-'));

try {
  const tarball = run(`npm pack --silent --pack-destination ${dir}`, root).trim().split('\n').pop();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
  const reactPath = join(root, 'node_modules/react');
  const reactDomPath = join(root, 'node_modules/react-dom');
  run(`npm install --silent --no-audit --no-fund ${join(dir, tarball)} ${reactPath} ${reactDomPath}`, dir);

  const body = `
    const assert = (cond, msg) => { if (!cond) { console.error('FAIL ' + msg); process.exit(1); } };
    const core = await load('vizbrix');
    const react = await load('vizbrix/react');
    const stat = await load('vizbrix/react/static');
    const charts = await load('vizbrix/charts');
    const bricks = await load('vizbrix/bricks');
    const ja = await load('vizbrix/locales/ja');
    const { createElement } = await load('react');
    const { renderToStaticMarkup } = await load('react-dom/server');
    assert(typeof core.createDashboard === 'function', 'core.createDashboard');
    assert(typeof react.Dashboard === 'object' || typeof react.Dashboard === 'function', 'react.Dashboard');
    assert(typeof charts.LineChart === 'function', 'charts.LineChart');
    assert(typeof bricks.builtinBricks.line.render === 'function', 'bricks.builtinBricks');
    assert(ja.ja.lang === 'ja', 'locales/ja');
    const doc = core.createDashboard({ items: [{ id: 'a', type: 'stat', title: 'T', w: 300, h: 120, props: { value: 42 } }] });
    const html = renderToStaticMarkup(createElement(stat.DashboardStatic, { id: 'd', value: doc, bricks: bricks.builtinBricks }));
    assert(html.includes('42') && html.includes('data-vbx-item="a"'), 'static render');
    const html2 = renderToStaticMarkup(createElement(react.Dashboard, { defaultValue: doc, bricks: bricks.builtinBricks }));
    assert(html2.includes('42'), 'client component SSR');
    console.log('ok');
  `;
  writeFileSync(join(dir, 'esm.mjs'), `const load = (s) => import(s);${body}`);
  writeFileSync(join(dir, 'cjs.cjs'), `const load = async (s) => require(s);(async () => {${body}})();`);
  console.log('esm:', run('node esm.mjs', dir).trim());
  console.log('cjs:', run('node cjs.cjs', dir).trim());

  const pkg = join(dir, 'node_modules/vizbrix/dist');
  const banner = (f) => readFileSync(join(pkg, f), 'utf8').trimStart().startsWith('"use client"');
  for (const f of ['react/index.js', 'react/index.cjs', 'charts/index.js', 'charts/index.cjs', 'echarts/index.js', 'echarts/core.cjs']) {
    if (!banner(f)) throw new Error(`${f} is missing its "use client" banner`);
  }
  for (const f of ['index.js', 'react/static.js', 'bricks/index.js', 'locales/ja.js', 'react/static.cjs', 'bricks/index.cjs']) {
    if (banner(f)) throw new Error(`${f} must not carry a "use client" banner`);
  }
  readFileSync(join(pkg, 'styles.css'));
  console.log('banners and stylesheet: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
