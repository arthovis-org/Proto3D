// Every directory under addons/ with an addon.json must validate, use a unique id and prefix,
// have a shell-based index.html and be listed in addons/registry.json (the Pages listing) unless
// it is the template. The template is tested like any other add-on but never listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, SDK_VERSION } from '../manifest.js';
import { discoverAddons } from '../testing/run-addons.js';

const ADDONS = path.resolve(new URL('../../', import.meta.url).pathname);

test('every add-on manifest validates, ids and prefixes are unique, entry and styles exist', () => {
  const addons = discoverAddons();
  assert.ok(addons.length >= 2, 'expected at least the template and gateway-credits');
  const ids = new Set(), prefixes = new Set();
  for (const a of addons) {
    const m = validateManifest(a.manifest);
    assert.equal(m.sdk, SDK_VERSION, `${a.dir}: targets SDK ${m.sdk}`);
    assert.ok(!ids.has(m.id), `${a.dir}: duplicate id ${m.id}`); ids.add(m.id);
    assert.ok(!prefixes.has(m.prefix), `${a.dir}: duplicate prefix ${m.prefix}`); prefixes.add(m.prefix);
    assert.equal(m.id === 'template' || m.id === a.dir, true, `${a.dir}: directory name should equal the manifest id (${m.id})`);
    assert.ok(fs.existsSync(path.join(a.path, m.entry)), `${a.dir}: entry ${m.entry} missing`);
    for (const s of m.styles) assert.ok(fs.existsSync(path.join(a.path, s)), `${a.dir}: stylesheet ${s} missing`);
    const html = fs.readFileSync(path.join(a.path, 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="\.\.\/sdk\/shell\.js"><\/script>/, `${a.dir}/index.html must boot through the SDK shell`);
    assert.ok(!/<script type="importmap">/.test(html), `${a.dir}/index.html must not carry its own import map (the shell copies the core's)`);
    assert.ok(!/id="viewport"|id="menubar"/.test(html), `${a.dir}/index.html must not copy the core DOM skeleton`);
  }
});

test('addons/registry.json lists every add-on except the template, with matching ids and names', () => {
  const listed = JSON.parse(fs.readFileSync(path.join(ADDONS, 'registry.json'), 'utf8'));
  const expected = discoverAddons().filter((a) => a.dir !== '_template').map((a) => ({ id: a.manifest.id, dir: a.dir, name: a.manifest.name, version: a.manifest.version, description: a.manifest.description || '' })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(listed.addons.slice().sort((a, b) => a.id.localeCompare(b.id)), expected, 'add the add-on to addons/registry.json (id, dir, name, version, description from its addon.json)');
});
