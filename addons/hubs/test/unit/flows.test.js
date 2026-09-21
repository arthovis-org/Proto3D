// Flow layouts are pure and deterministic: every item gets a position, no two share one, the
// Compare grid lines the same section up in one column, the Audience lanes group by audience.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFlow, FLOW_IDS, GAP, layoutBounds, sortPages, collides, dimsOf, levelBases, arcPlace } from '../../src/flows.js';
import { cardDims } from '../../src/sizing.js';
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
/** No two placed items may touch: real footprints, vertical extents, rotation-agnostic. */
const collisionFree = (flow, items, map) => { const list = items.filter((i) => map.has(i.uid)); for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!collides(list[i], map.get(list[i].uid), list[j], map.get(list[j].uid)), `${flow}: ${list[i].uid} and ${list[j].uid} collide at ${JSON.stringify(map.get(list[i].uid))} / ${JSON.stringify(map.get(list[j].uid))}`); };

test('every flow places every item exactly once, collision-free, with a base elevation and a rotation, deterministically', () => {
  for (const flow of FLOW_IDS) {
    for (const items of [itemsFor(['cal-tenant-law']), itemsFor(CLIENTS.map((c) => c.slug), { headers: true }), [{ uid: 'x', type: 'unknown-thing', params: {} }, ...itemsFor(['hoy'])]]) {
      const a = layoutFlow(flow, items), b = layoutFlow(flow, items);
      assert.equal(a.size, items.length, `${flow}: ${a.size} of ${items.length} placed`);
      for (const it of items) { const p = a.get(it.uid); assert.ok(p, `${flow}: ${it.uid} missing`); assert.deepEqual(Object.keys(p), ['x', 'y', 'z', 'ry']); assert.ok(p.y >= 0 && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.ry) <= Math.PI); }
      assert.deepEqual([...a], [...b], `${flow}: not deterministic`);
      collisionFree(flow, items, a);
    }
  }
  assert.deepEqual([...layoutFlow('delivery', [])], []);
  // footprints: pages take their real card size, other nodes their defaults, an item's own size wins
  assert.deepEqual(dimsOf({ type: 'hub-page', params: { device: 'phone' } }), { width: cardDims({ device: 'phone' }).width, height: cardDims({ device: 'phone' }).height });
  assert.deepEqual(dimsOf({ type: 'hub-blueprint', params: {} }), { width: 9, height: 6.06 });
  assert.deepEqual(dimsOf({ type: 'hub-page', params: {}, width: 5, height: 2 }), { width: 5, height: 2 });
  assert.deepEqual(levelBases([8, 3.4, 6]), [0, 9.6, 14.6]);
});

test('delivery: a climbing arc per client facing its centre, blueprint front-centre, clients stacked as levels', () => {
  const items = itemsFor(['petrock']);
  const map = layoutFlow('delivery', items);
  const pages = sortPages(items.filter((i) => i.type === 'hub-page')).map((i) => ({ i, p: map.get(i.uid) }));
  const bp = map.get('bp-petrock');
  assert.equal(bp.x, 0); assert.equal(bp.ry, 0); assert.equal(bp.y, 0);
  // one arc slot per section: the first page of a section on the ground arc, the others rising above it at the same angle
  const ground = pages.filter(({ i }, k) => k === 0 || pages[k - 1].i.params.section !== i.params.section);
  const mid = ground[Math.floor(ground.length / 2)];
  assert.ok(bp.z > mid.p.z + 5, 'the blueprint stands in front of the arc\'s middle, inside the horseshoe');
  for (let k = 1; k < ground.length; k++) { assert.ok(ground[k].p.x > ground[k - 1].p.x, 'sections left to right'); assert.ok(ground[k].p.y >= ground[k - 1].p.y, 'climbing'); }
  assert.ok(ground.at(-1).p.y > ground[0].p.y + 2, 'later phases sit higher');
  for (const { i, p } of pages) { const first = ground.find((g) => g.i.params.section === i.params.section); assert.ok(Math.abs(p.ry - first.p.ry) < 1e-9, `${i.uid} keeps its section's angle`); if (first.i !== i) assert.ok(p.y >= first.p.y + dimsOf(first.i).height + GAP.level - 1e-6, `${i.uid} rises above its section's first page`); }
  // cards face the arc's centre: x < 0 turns right (positive ry), the middle faces straight
  assert.ok(Math.abs(mid.p.ry) < 0.3); assert.ok(ground[0].p.ry > 0.3 && ground.at(-1).p.ry < -0.3);
  assert.ok(ground[0].p.z > mid.p.z && ground.at(-1).p.z > mid.p.z, 'the ends come forward');
  const arc = arcPlace(items.filter((i) => i.type === 'hub-page'));
  assert.ok(arc.theta <= GAP.maxArc + 1e-9 && arc.R >= GAP.minRadius);
  const b = layoutBounds(layoutFlow('delivery', itemsFor(['cal-tenant-law'])));
  assert.ok(b.maxX - b.minX < 80 && b.maxZ - b.minZ < 30, `a 21-page arc stays compact (${(b.maxX - b.minX).toFixed(0)} × ${(b.maxZ - b.minZ).toFixed(0)}) so its framing stays under the LOD distance`);
  // two clients → two levels: the second clears the first's tallest card plus the margin
  const two = layoutFlow('delivery', itemsFor(['petrock', 'hoy']));
  assert.equal(two.get('bp-petrock').y, 0);
  const petrockTop = Math.max(...itemsFor(['petrock']).map((i) => two.get(i.uid).y + dimsOf(i).height));
  assert.ok(two.get('bp-hoy').y >= petrockTop + GAP.level - 1e-6, `hoy level ${two.get('bp-hoy').y} clears petrock ${petrockTop}`);
});

test('compare: clients are levels stepped up and back, the same section of every client shares a column, blueprints lead each level', () => {
  const items = itemsFor(CLIENTS.map((c) => c.slug));
  for (const c of CLIENTS) items.push({ uid: `lbl-${c.slug}`, type: 'hub-section', params: { section: 'hub', client: c.slug, label: c.name } });
  const map = layoutFlow('compare', items);
  const levels = CLIENTS.map((c) => map.get(`bp-${c.slug}`));
  assert.equal(levels[0].y, 0);
  const H = cardDims({ device: 'desktop' }).height;
  for (let i = 1; i < levels.length; i++) { assert.ok(levels[i].y >= levels[i - 1].y + 2 * H + GAP.level - 1e-6, `level ${i} leaves a card height of air above level ${i - 1} (${levels[i].y - levels[i - 1].y})`); assert.ok(levels[i].z < levels[i - 1].z, `level ${i} stepped back`); }
  // the label card sits at the left end of its level, left of every page, right of the blueprint
  for (const c of CLIENTS) { const l = map.get(`lbl-${c.slug}`), bp = map.get(`bp-${c.slug}`); assert.equal(l.y, bp.y, `${c.slug} label on its level`); assert.ok(l.x > bp.x && l.x < 0, `${c.slug} label between the blueprint and the columns`); }
  // eleven columns are too wide for one row: a front and a back bank, the back one stepped back and slightly up
  const banks = new Set([...map].filter(([uid]) => uid.startsWith('cal-tenant-law-')).map(([, p]) => p.z));
  assert.equal(banks.size, 2, 'two banks'); const [zFront, zBack] = [...banks].sort((a, b) => b - a); assert.ok(zFront - zBack >= GAP.bankBack - 1e-6);
  const bounds = layoutBounds(map); assert.ok(bounds.maxX - bounds.minX < 130, `the grid is ${(bounds.maxX - bounds.minX).toFixed(0)} wide`);
  const colX = new Map();   // section → x of its first page, must agree across clients
  for (const c of CLIENTS) {
    const pages = sortPages(items.filter((x) => x.type === 'hub-page' && x.params.client === c.slug));
    for (const p of pages) { const q = map.get(p.uid); assert.ok(q.y === map.get(`bp-${c.slug}`).y || q.y === map.get(`bp-${c.slug}`).y + GAP.bankUp, `${p.uid} on its client's level (or its back bank)`); assert.equal(q.ry, 0); }
    for (const s of new Set(pages.map((p) => p.params.section))) {
      const first = pages.find((p) => p.params.section === s);
      const x = map.get(first.uid).x - dimsOf(first).width / 2;   // the cell's left edge
      if (colX.has(s)) assert.equal(x, colX.get(s), `${c.slug}: section ${s} column`); else colX.set(s, x);
    }
  }
  const front = [...colX].filter(([s]) => sectionById(s).phase <= 5).sort((a, b) => a[1] - b[1]).map(([s]) => sectionById(s).phase);
  assert.deepEqual(front, [...front].sort((a, b) => a - b), 'the front bank follows phase order left → right');
  assert.ok(CLIENTS.every((c) => map.get(`bp-${c.slug}`).x < Math.min(...colX.values())));
});

test('audience: one floor per audience (customers at the ground); devices: three levels; sitemap: hub at the base, ring above, pages rising', () => {
  const items = itemsFor(['cal-tenant-law']);
  const aud = layoutFlow('audience', items);
  const floorOf = new Map();
  for (const it of items) if (it.type === 'hub-page') { const y = aud.get(it.uid).y; if (floorOf.has(it.params.audience)) assert.equal(y, floorOf.get(it.params.audience), `${it.uid} floor`); else floorOf.set(it.params.audience, y); }
  assert.ok(floorOf.size >= 5); assert.equal(new Set(floorOf.values()).size, floorOf.size, 'one floor per audience');
  assert.equal(floorOf.get('customers'), 0, 'customers at the ground');
  const order = [...floorOf].sort((a, b) => a[1] - b[1]).map(([a]) => a);
  assert.deepEqual(order.filter((a) => ['customers', 'staff', 'owner', 'developers'].includes(a)), ['customers', 'staff', 'owner', 'developers']);
  const floorY = [...floorOf.values()].sort((a, b) => a - b);
  for (let i = 1; i < floorY.length; i++) assert.ok(floorY[i] - floorY[i - 1] >= 3.86 + GAP.level - 1e-6, 'floors clear the cards below');
  const dev = layoutFlow('devices', items);
  const bandOf = (d) => (d === 'phone' ? 0 : d === 'tablet' ? 1 : 2);
  const levelY = [0, 1, 2].map((b) => Math.min(...items.filter((i) => i.type === 'hub-page' && bandOf(i.params.device) === b).map((i) => dev.get(i.uid).y)));
  assert.equal(levelY[0], 0); assert.ok(levelY[1] > levelY[0] && levelY[2] > levelY[1], `devices levels rise: ${levelY}`);
  const sm = layoutFlow('sitemap', items);
  const hub = items.find((i) => i.params.section === 'hub' && i.type === 'hub-page');
  assert.deepEqual(sm.get(hub.uid), { x: 0, y: 0, z: 0, ry: 0 });
  for (const it of items) if (it.type === 'hub-page' && it !== hub) { const p = sm.get(it.uid); assert.ok(p.z < -8, `${it.uid} behind the hub`); assert.ok(p.y >= dimsOf(hub).height + GAP.level - 1e-6, `${it.uid} above the hub`); }
  const staff = sortPages(items.filter((i) => i.type === 'hub-page' && i.params.section === 'staff')).map((i) => sm.get(i.uid));
  for (let k = 1; k < staff.length; k++) { assert.ok(staff[k].y > staff[k - 1].y, 'a section column rises'); assert.ok(Math.abs(staff[k].ry - staff[0].ry) < 1e-9, 'and keeps its angle'); }
  const b = layoutBounds(sm); assert.ok(b.maxZ === 0 && b.minZ < -10 && b.maxY > 20);
});
