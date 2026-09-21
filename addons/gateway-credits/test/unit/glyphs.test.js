// Service glyphs: every provider and tool service on the rate card has an original glyph with its
// own accent colour; ids are unique; the SVG and the canvas drawer render the same segments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, GLYPH_IDS, toSvg, iconTable, iconName, drawGlyph, drawBadge, glyphFor, glyphIdFor, withAlpha } from '../../src/glyphs.js';
import { PROVIDERS } from '../../src/rates.js';
import { fakeCanvasContext } from '../../../sdk/testing/fake-host.js';

test('every provider / service in rates.js has a glyph, a label and a distinct accent colour; ids are unique', () => {
  for (const p of Object.values(PROVIDERS)) {
    const g = GLYPHS[p.id];
    assert.ok(g, `no glyph for ${p.id}`); assert.equal(g.kind, p.kind, `${p.id} kind`); assert.ok(g.label && g.segments.length >= 1, `${p.id} shape`);
    assert.match(g.color, /^#[0-9a-f]{6}$/i, `${p.id} colour`);
  }
  for (const role of ['form', 'memory', 'agent', 'budget', 'meter']) assert.equal(GLYPHS[role]?.kind, 'role', role);
  assert.equal(new Set(GLYPH_IDS).size, GLYPH_IDS.length);
  const colours = GLYPH_IDS.map((id) => GLYPHS[id].color.toLowerCase());
  assert.equal(new Set(colours).size, colours.length, 'accent colours are distinct per glyph');
  // distinct silhouettes: no two glyphs share the same segment list
  const shapes = GLYPH_IDS.map((id) => JSON.stringify(GLYPHS[id].segments));
  assert.equal(new Set(shapes).size, shapes.length, 'no two glyphs draw the same shape');
});

test('toSvg renders the core icon style (24×24, currentColor stroke) and the icon table names every glyph gw-svc-<id>', () => {
  const svg = toSvg('firecrawl');
  assert.match(svg, /^<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"/);
  assert.match(svg, /data-glyph="firecrawl"/); assert.match(svg, /<path d="M12 3Q12.5 8 16.5 10.5/);
  assert.match(toSvg('browserbase'), /<circle [^>]*fill="currentColor" stroke="none"\/>/, 'filled segments carry their own fill');
  assert.match(toSvg('minimax'), /<rect x="3" y="5" width="18" height="14" rx="3"\/>/);
  assert.equal(toSvg('nope'), '');
  const table = iconTable();
  assert.deepEqual(Object.keys(table), GLYPH_IDS.map(iconName));
  assert.ok(Object.keys(table).every((k) => k.startsWith('gw-svc-')), 'icon names carry the add-on prefix so core icons are never shadowed');
  assert.ok(!/logo|trademark/i.test(JSON.stringify(GLYPHS)), 'glyphs are original monograms, named honestly');
});

test('drawGlyph paints the same segments with plain path calls; drawBadge adds the disc and ring', () => {
  const g = fakeCanvasContext();
  assert.equal(drawGlyph(g, 'anthropic', 10, 20, 48, '#e8743b'), true);
  const names = g.calls.map((c) => c[0]);
  assert.ok(names.includes('moveTo') && names.includes('lineTo') && names.includes('stroke'));
  const first = g.calls.find((c) => c[0] === 'moveTo'); assert.deepEqual(first.slice(1), [10 + 4 * 2, 20 + 20 * 2], 'scaled from the 24-box: (4,20) at 2 px/unit');
  assert.ok(!names.includes('drawImage'), 'no Image loading');
  assert.equal(drawGlyph(g, 'unknown', 0, 0, 10), false);
  const b = fakeCanvasContext(); drawBadge(b, 'brave', 40, 40, 30);
  const arcs = b.calls.filter((c) => c[0] === 'arc'); assert.ok(arcs.length >= 3, 'disc, ring and the glyph circle');
  assert.equal(arcs[0][3], 30);
  const q = fakeCanvasContext(); drawGlyph(q, 'firecrawl', 0, 0, 24); assert.ok(q.calls.some((c) => c[0] === 'quadraticCurveTo'));
  const r = fakeCanvasContext(); drawGlyph(r, 'form', 0, 0, 24); assert.ok(r.calls.some((c) => c[0] === 'arcTo'), 'rounded rects use arcTo');
});

test('glyphFor resolves a node\'s current provider / service / role to { id, svg, color, label }; unknowns fall back', () => {
  const a = glyphFor('llm', { provider: 'Anthropic' }); assert.equal(a.id, 'anthropic'); assert.equal(a.color, '#e8743b'); assert.equal(a.label, 'Anthropic'); assert.match(a.svg, /data-glyph="anthropic"/);
  assert.equal(glyphFor('llm', { provider: 'Baseten' }).id, 'baseten'); assert.equal(glyphFor('llm', { provider: 'Eden AI' }).id, 'edenai');
  const t = glyphFor('tool', { service: 'Firecrawl' }); assert.equal(t.id, 'firecrawl'); assert.equal(t.color, '#f97316');
  assert.equal(glyphFor('agent').id, 'agent'); assert.equal(glyphFor('memory').id, 'memory'); assert.equal(glyphFor('budget').label, 'Budget'); assert.equal(glyphFor('form').id, 'form');
  assert.equal(glyphFor('x', { providerId: 'brave' }).id, 'brave', 'a ledger row\'s providerId resolves too');
  const u = glyphFor('llm', { provider: 'Nobody' }); assert.equal(u.id, null); assert.equal(u.label, 'Nobody'); assert.equal(u.svg, '');
  assert.equal(glyphIdFor('pdfco'), 'pdfco'); assert.equal(glyphIdFor('zzz'), null);
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)'); assert.equal(withAlpha('red', 0.5), 'red');
});
