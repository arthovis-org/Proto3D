import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanAddons, assertNoDrift, classify, ADDONS_DIR, REPO_ROOT } from '../testing/drift-guard.js';

test('no add-on imports the core (only addons/sdk/** and its own files)', () => {
  const v = scanAddons(ADDONS_DIR, REPO_ROOT);
  assert.deepEqual(v, [], `violations:\n${v.map((x) => `${x.file}:${x.line} ${x.spec} — ${x.reason}`).join('\n')}`);
  assert.equal(assertNoDrift(), true);
});

test('classify: relative, absolute, bare and URL specifiers', () => {
  const file = path.join(REPO_ROOT, 'addons', 'demo', 'src', 'x.js');
  assert.match(classify('../../../src/core/registry.js', file), /resolves into core: src/);
  assert.match(classify('../../../index.html', file), /core page: index\.html/);
  assert.match(classify('../../../styles.css', file), /core page: styles\.css/);
  assert.match(classify('/src/main.js', file), /absolute core path/);
  assert.match(classify('../../../../elsewhere.js', file), /escapes the repository/);
  assert.equal(classify('../../sdk/host.js', file), null);
  assert.equal(classify('./ledger.js', file), null);
  assert.equal(classify('three', file), null, 'bare specifiers belong to the import map');
  assert.equal(classify('https://unpkg.com/three@0.160.0/build/three.module.js', file), null);
});

test('the guard catches every import form in a violating add-on (self-test on a temp tree)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
  const addons = path.join(root, 'addons');
  fs.mkdirSync(path.join(addons, 'bad', 'src'), { recursive: true });
  fs.mkdirSync(path.join(addons, 'sdk'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'core'), { recursive: true });
  fs.writeFileSync(path.join(addons, 'sdk', 'host.js'), "import { registry } from '../../src/core/registry.js'; // allowed: the SDK is the one place\n");
  fs.writeFileSync(path.join(addons, 'bad', 'src', 'a.js'), [
    "import { registry } from '../../../src/core/registry.js';",
    "import '../../../src/main.js';",
    "export { icons } from '../../../src/icons.js';",
    "const m = await import('../../../src/theme.js');",
    "import { createHost } from '../../sdk/host.js';",
    "import { x } from './b.js';",
    "import * as THREE from 'three';",
  ].join('\n'));
  fs.writeFileSync(path.join(addons, 'bad', 'index.html'), '<link rel="stylesheet" href="../../styles.css" /><script type="module" src="../../src/main.js"></script><script type="module" src="../sdk/shell.js"></script>');
  fs.writeFileSync(path.join(addons, 'bad', 'src', 'a.css'), "@import '../../../styles.css';\n@import url('./b.css');");
  const v = scanAddons(addons, root);
  const specs = v.map((x) => x.spec).sort();
  assert.deepEqual(specs, ['../../../src/core/registry.js', '../../../src/icons.js', '../../../src/main.js', '../../../src/theme.js', '../../../styles.css', '../../src/main.js', '../../styles.css'].sort());
  assert.ok(v.every((x) => x.file.startsWith(path.join('addons', 'bad'))), 'the sdk directory is exempt');
  assert.ok(v.every((x) => x.line >= 1));
  assert.throws(() => assertNoDrift(addons, root), /drift guard: 7 add-on file\(s\) reach into the core/);
  fs.rmSync(root, { recursive: true, force: true });
});
