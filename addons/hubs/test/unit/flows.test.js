// Flow layouts are pure and deterministic: every item gets a position, no two share one, the
// Compare grid lines the same section up in one column, the Audience lanes group by audience.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFlow, FLOW_IDS, GAP, layoutBounds, sortPages } from '../../src/flows.js';
import { CLIENTS, pagesOf, blueprintParams } from '../../src/clients.js';
import { pageParams } from '../../src/generate.js';
import { sectionById } from '../../src/template.js';

const itemsFor = (slugs, { headers = false } = {}) => {
  const items = [];
  for (const slug of slugs) {
    const bp = blueprintParams(slug); items.push({ uid: `bp-${slug}`, type: 'hub-blueprint', params: bp });
    pagesOf(slug).forEach((d, i) => items.push({ uid: `${slug}-${i}`, type: 'hub-page', params: pageParams(d) }));
    if (headers) for (const s of ['site', 'app', 'dev']) items.push({ uid: `h-${slug}-${s}`, type: 'hub-section', params: { section: s, client: slug } });
  }
  return items;
};
const distinct = (map) => { const seen = new Set(); for (const [uid, p] of map) { const k = `${Math.round(p[0] * 2)}|${Math.round(p[2] * 2)}`; assert.ok(!seen.has(k), `${uid} shares a position (${p}) with another node`); seen.add(k); } };

test('every flow places every item exactly once, at distinct positions, with y = null, deterministically', () => {
  for (const flow of FLOW_IDS) {
    for (const items of [itemsFor(['cal-tenant-law']), itemsFor(CLIENTS.map((c) => c.slug), { headers: true }), [{ uid: 'x', type: 'unknown-thing', params: {} }, ...itemsFor(['hoy'])]]) {
      const a = layoutFlow(flow, items), b = layoutFlow(flow, items);
      assert.equal(a.size, items.length, `${flow}: ${a.size} of ${items.length} placed`);
      for (const it of items) { const p = a.get(it.uid); assert.ok(p, `${flow}: ${it.uid} missing`); assert.equal(p.length, 3); assert.equal(p[1], null); assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[2])); }
      assert.deepEqual([...a], [...b], `${flow}: not deterministic`);
      distinct(a);
    }
  }
  assert.deepEqual([...layoutFlow('delivery', [])], []);
});

test('delivery: one row per client in phase order, blueprint first, a wider gap between sections', () => {
  const items = itemsFor(['petrock']);
  const map = layoutFlow('delivery', items);
  const bp = map.get('bp-petrock'); assert.deepEqual(bp, [0, null, 0]);
  const pages = sortPages(items.filter((i) => i.type === 'hub-page')).map((i) => ({ i, p: map.get(i.uid) }));
  assert.ok(pages.every(({ p }) => p[2] === 0), 'one row');
  for (let k = 1; k < pages.length; k++) {
    const dx = pages[k].p[0] - pages[k - 1].p[0];
    const sameSection = pages[k].i.params.section === pages[k - 1].i.params.section;
    assert.ok(Math.abs(dx - (sameSection ? GAP.x : GAP.x + GAP.section)) < 1e-6, `${pages[k].i.uid}: dx ${dx}`);
  }
  assert.ok(pages[0].p[0] >= GAP.blueprint);
  // two clients → two rows
  const two = layoutFlow('delivery', itemsFor(['petrock', 'hoy']));
  assert.equal(two.get('bp-petrock')[2], 0); assert.equal(two.get('bp-hoy')[2], GAP.z);
});

test('compare: clients are rows, the same section of every client shares a column, blueprints lead each row', () => {
  const items = itemsFor(CLIENTS.map((c) => c.slug));
  const map = layoutFlow('compare', items);
  const rowZ = CLIENTS.map((c) => map.get(`bp-${c.slug}`)[2]);
  assert.deepEqual(rowZ, [0, GAP.z, 2 * GAP.z, 3 * GAP.z]);
  const colX = new Map();   // section → x of its first page, must agree across clients
  for (const it of items) {
    if (it.type !== 'hub-page') continue;
    const p = map.get(it.uid);
    assert.equal(p[2], rowZ[CLIENTS.findIndex((c) => c.slug === it.params.client)], `${it.uid} on its client's row`);
    if (it.params.order === 0 || !sortPages(items.filter((x) => x.type === 'hub-page' && x.params.client === it.params.client && x.params.section === it.params.section)).slice(1).includes(it)) { /* first page of the cell */ }
  }
  for (const c of CLIENTS) {
    const pages = sortPages(items.filter((x) => x.type === 'hub-page' && x.params.client === c.slug));
    for (const s of new Set(pages.map((p) => p.params.section))) {
      const first = pages.find((p) => p.params.section === s);
      const x = map.get(first.uid)[0];
      if (colX.has(s)) assert.equal(x, colX.get(s), `${c.slug}: section ${s} column`); else colX.set(s, x);
    }
  }
  // columns follow phase order left → right
  const cols = [...colX].sort((a, b) => a[1] - b[1]).map(([s]) => sectionById(s).phase);
  assert.deepEqual(cols, [...cols].sort((a, b) => a - b));
  assert.ok(CLIENTS.every((c) => map.get(`bp-${c.slug}`)[0] < Math.min(...colX.values())));
});

test('audience: swimlanes by audience; devices: three bands; sitemap: the hub page in front, sections behind', () => {
  const items = itemsFor(['cal-tenant-law']);
  const aud = layoutFlow('audience', items);
  const laneOf = new Map();
  for (const it of items) if (it.type === 'hub-page') { const z = aud.get(it.uid)[2]; if (laneOf.has(it.params.audience)) assert.equal(z, laneOf.get(it.params.audience), `${it.uid} lane`); else laneOf.set(it.params.audience, z); }
  assert.ok(laneOf.size >= 5); assert.equal(new Set(laneOf.values()).size, laneOf.size, 'one lane per audience');
  const dev = layoutFlow('devices', items);
  const bandOf = (d) => (d === 'phone' ? 0 : d === 'tablet' ? 1 : 2);
  for (const it of items) if (it.type === 'hub-page') assert.equal(dev.get(it.uid)[2], bandOf(it.params.device) * GAP.z, `${it.uid} band`);
  const sm = layoutFlow('sitemap', items);
  const hub = items.find((i) => i.params.section === 'hub' && i.type === 'hub-page');
  assert.deepEqual(sm.get(hub.uid), [0, null, 0]);
  for (const it of items) if (it.type === 'hub-page' && it !== hub) assert.ok(sm.get(it.uid)[2] < -GAP.z, `${it.uid} behind the hub`);
  const b = layoutBounds(sm); assert.ok(b.maxZ === 0 && b.minZ < -20 && b.cx !== undefined);
});
