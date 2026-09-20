// sdk/testing/run-addons.js — discovers add-ons (directories under addons/ with an addon.json,
// the template included) and runs each one's Node tests (test/**/*.test.js, browser tests
// excluded) with `node --test`. `node run-addons.js gateway-credits` runs one add-on (the CI
// matrix does this); `node run-addons.js --list` prints the add-on ids as JSON for the matrix.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const ADDONS = path.join(REPO_ROOT, 'addons');

export function discoverAddons() {
  return fs.readdirSync(ADDONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ADDONS, e.name, 'addon.json')))
    .map((e) => ({ dir: e.name, path: path.join(ADDONS, e.name), manifest: JSON.parse(fs.readFileSync(path.join(ADDONS, e.name, 'addon.json'), 'utf8')) }));
}

function testFiles(dir, { browser = false } = {}) {
  const out = [];
  const walk = (d, inBrowser) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, inBrowser || e.name === 'browser');
      else if (/\.test\.m?js$/.test(e.name) && inBrowser === browser) out.push(p);
    }
  };
  walk(path.join(dir, 'test'), false);
  return out;
}

const args = process.argv.slice(2);
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const addons = discoverAddons();
  if (args.includes('--list')) { console.log(JSON.stringify(addons.map((a) => a.dir))); process.exit(0); }
  const only = args.filter((a) => !a.startsWith('--'));
  const browser = args.includes('--browser');
  let failed = 0;
  for (const a of addons) {
    if (only.length && !only.includes(a.dir) && !only.includes(a.manifest.id)) continue;
    const files = testFiles(a.path, { browser });
    if (!files.length) { console.log(`\n== ${a.dir}: no ${browser ? 'browser ' : ''}tests`); continue; }
    console.log(`\n== ${a.dir} (${a.manifest.id} v${a.manifest.version}) · ${files.length} file(s)`);
    const r = spawnSync(process.execPath, ['--test', ...(browser ? ['--test-concurrency=1'] : []), ...files], { stdio: 'inherit', cwd: REPO_ROOT, env: process.env });
    if (r.status !== 0) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}
