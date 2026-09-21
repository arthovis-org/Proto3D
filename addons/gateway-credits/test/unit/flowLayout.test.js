// flowLayout: pure and deterministic — ranks left to right at eye level, branches spread in z,
// slot children standing on the floor under their parent, budget / meter floating above the chain,
// no 3D overlaps on the sample-shaped graph; `flat` reproduces the one-level plan arrangement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowLayout, overlapping, slotChildren, isSlotKey, sizeOf, DEFAULT_SIZE, FLOW, LEVELS } from '../../src/flowLayout.js';

const N = (uid, type, size = 'M') => ({ uid, type, size });
/** Justin's shape: trigger → agent → own-key model → log; model + memory + 3 tools under the agent; budget + meter on top. */
function sample() {
  const nodes = [N('trigger', 'input', 'S'), N('agent', 'gw-agent', 'L'), N('draft', 'gw-llm', 'M'), N('log', 'log', 'M'), N('model', 'gw-llm', 'M'), N('memory', 'gw-memory', 'S'),
    N('search', 'gw-tool', 'M'), N('crawl', 'gw-tool', 'M'), N('pdf', 'gw-tool', 'M'), N('budget', 'gw-budget', 'M'), N('meter', 'gw-meter', 'M')];
  const connections = [
    { from: 'trigger', to: 'agent', toKey: 'trigger' }, { from: 'agent', to: 'draft', toKey: 'trigger' }, { from: 'agent', to: 'draft', toKey: 'prompt' }, { from: 'draft', to: 'log', toKey: 'trigger' }, { from: 'draft', to: 'log', toKey: 'in' },
    { from: 'model', to: 'agent', toKey: 'model' }, { from: 'memory', to: 'agent', toKey: 'memory' }, { from: 'search', to: 'agent', toKey: 'tools' }, { from: 'crawl', to: 'agent', toKey: 'tools' }, { from: 'pdf', to: 'agent', toKey: 'tools' },
  ];
  return { nodes, connections };
}
const X = (m, u) => m.get(u)[0], Y = (m, u) => m.get(u)[1], Z = (m, u) => m.get(u)[2];
const KIDS = ['model', 'memory', 'search', 'crawl', 'pdf'], CHAIN = ['trigger', 'agent', 'draft', 'log'];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} (${a} vs ${b})`);

test('slot keys and defaults (with a height per size)', () => {
  for (const k of ['model', 'memory', 'tools', 'tool', 'tool1', 'tool3']) assert.ok(isSlotKey(k), k);
  for (const k of ['trigger', 'prompt', 'in', 'toolbox', '', undefined]) assert.ok(!isSlotKey(k), String(k));
  for (const s of Object.values(DEFAULT_SIZE)) assert.ok(s.w > 0 && s.d > 0 && s.h > 0, JSON.stringify(s));
  assert.deepEqual(sizeOf({ size: 'L' }), DEFAULT_SIZE.L); assert.deepEqual(sizeOf({ size: 'M', w: 5, d: 4, h: 3 }), { w: 5, d: 4, h: 3 }); assert.deepEqual(sizeOf({}), DEFAULT_SIZE.S);
  assert.deepEqual(sizeOf({ size: 'M', w: 5 }), { w: 5, d: DEFAULT_SIZE.M.d, h: DEFAULT_SIZE.M.h }, 'a missing measure falls back per field');
  assert.deepEqual(LEVELS, { flow: 9, top: 17, ground: 0.2 });
  const { parentOf, kids } = slotChildren(sample().nodes, sample().connections);
  assert.deepEqual(kids.get('agent'), KIDS); assert.equal(parentOf.get('pdf'), 'agent'); assert.ok(!parentOf.has('draft'));
});

test('three levels: the chain left → right at eye level, slot children on the floor directly beneath the agent, budget and meter floating above the chain', () => {
  const { nodes, connections } = sample();
  const m = flowLayout(nodes, connections);
  assert.equal(m.size, nodes.length, 'every node gets a position');
  for (const p of m.values()) assert.equal(p.length, 3, 'positions are [x, y, z]');
  // exactly three y bands
  const bands = [...new Set([...m.values()].map((p) => p[1]))].sort((a, b) => a - b);
  assert.equal(bands.length, 3, `three distinct heights: ${bands}`);
  // level 1: the chain at the flow level, left → right, on one z row
  for (const u of CHAIN) { near(Y(m, u), LEVELS.flow, `${u} at eye level`); near(Z(m, u), 0, `${u} on the chain row`); }
  assert.ok(X(m, 'trigger') < X(m, 'agent') && X(m, 'agent') < X(m, 'draft') && X(m, 'draft') < X(m, 'log'), 'left to right');
  const gapAgentDraft = (X(m, 'draft') - DEFAULT_SIZE.M.w / 2) - (X(m, 'agent') + DEFAULT_SIZE.L.w / 2);
  const gapDraftLog = (X(m, 'log') - DEFAULT_SIZE.M.w / 2) - (X(m, 'draft') + DEFAULT_SIZE.M.w / 2);
  near(gapDraftLog, FLOW.colGap, 'column gap');
  assert.ok(gapAgentDraft >= FLOW.colGap - 1e-6, 'the agent column is as wide as its row of slot children');
  // level 0: the children stand on the floor (bottom at the ground level), under the agent's x-centre, one step toward the camera
  for (const k of KIDS) {
    const s = sizeOf(nodes.find((n) => n.uid === k));
    assert.ok(Y(m, k) < Y(m, 'agent'), `${k} below the agent`);
    near(Y(m, k) - s.h / 2, LEVELS.ground, `${k} stands on the floor`);
    assert.ok(Y(m, k) + s.h / 2 < Y(m, 'agent') - DEFAULT_SIZE.L.h / 2, `${k} clears the agent's bottom`);
    assert.ok(Math.abs(Z(m, k) - Z(m, 'agent')) <= 1.2, `${k} directly beneath the agent (z ${Z(m, k)} vs ${Z(m, 'agent')})`);
  }
  for (let i = 1; i < KIDS.length; i++) assert.ok(X(m, KIDS[i]) > X(m, KIDS[i - 1]), 'children left to right in slot order');
  for (let i = 1; i < KIDS.length; i++) near(Math.abs(Z(m, KIDS[i]) - Z(m, KIDS[i - 1])), 2 * FLOW.slotStagger, 'neighbours alternate between two z lanes, so a cable leaving one never starts inside the next');
  for (const k of KIDS) assert.ok(Z(m, k) >= Z(m, 'agent'), `${k} on or in front of the agent's plane`);
  const rowL = X(m, 'model') - DEFAULT_SIZE.M.w / 2, rowR = X(m, 'pdf') + DEFAULT_SIZE.M.w / 2;
  near((rowL + rowR) / 2, X(m, 'agent'), 'the row shares the agent\'s x-centre');
  // level 2: budget / meter above the chain, on the chain's z row, centred over its x-extent
  for (const u of ['budget', 'meter']) { assert.ok(Y(m, u) > Y(m, 'agent') + DEFAULT_SIZE.L.h / 2, `${u} above the chain`); near(Y(m, u), LEVELS.top, `${u} at the top level`); near(Z(m, u), 0, `${u} over the chain row`); }
  assert.ok(X(m, 'budget') < X(m, 'meter'));
  const all = [...m.entries()]; const minX = Math.min(...all.map(([u, p]) => p[0] - sizeOf(nodes.find((n) => n.uid === u)).w / 2)), maxX = Math.max(...all.map(([u, p]) => p[0] + sizeOf(nodes.find((n) => n.uid === u)).w / 2));
  near((X(m, 'budget') - DEFAULT_SIZE.M.w / 2 + X(m, 'meter') + DEFAULT_SIZE.M.w / 2) / 2, (minX + maxX) / 2, 'the governance row is centred over the flow');
  assert.ok(X(m, 'budget') > X(m, 'trigger'), 'not parked off to the left');
  // clean in 3D
  assert.deepEqual(overlapping(nodes, m), []);
});

test('levels are options: a taller flow lifts the top row; the ground uses the measured height', () => {
  const { nodes, connections } = sample();
  const m = flowLayout(nodes, connections, { levels: { flow: 12, top: 15, ground: 1 } });
  near(Y(m, 'agent'), 12, 'flow level'); near(Y(m, 'model') - DEFAULT_SIZE.M.h / 2, 1, 'ground level');
  assert.ok(Y(m, 'budget') > 12 + DEFAULT_SIZE.L.h / 2 + FLOW.topGap, 'the top row clears a tall flow even when levels.top is too low');
  const measured = nodes.map((n) => (n.uid === 'pdf' ? { ...n, h: 2 } : n));
  const m2 = flowLayout(measured, connections);
  near(Y(m2, 'pdf'), LEVELS.ground + 1, 'a measured h puts the block\'s bottom on the floor'); near(Y(m2, 'crawl'), LEVELS.ground + DEFAULT_SIZE.M.h / 2, 'defaults elsewhere');
  assert.deepEqual(overlapping(measured, m2), []);
});

test('flat: the one-level plan arrangement — children one z-step behind their parent, budget / meter behind the chain, [x, z] pairs (heights untouched)', () => {
  const { nodes, connections } = sample();
  const m = flowLayout(nodes, connections, { flat: true });
  assert.equal(m.size, nodes.length);
  for (const p of m.values()) assert.equal(p.length, 2, 'pairs: host.layout.apply keeps y');
  const Zf = (u) => m.get(u)[1];
  for (const u of CHAIN) near(Zf(u), 0, `${u} on the chain row`);
  for (const k of KIDS) assert.ok(Zf(k) > Zf('agent') + DEFAULT_SIZE.L.d / 2, `${k} behind the agent`);
  const tops = KIDS.map((k) => Zf(k) - sizeOf(nodes.find((n) => n.uid === k)).d / 2);
  for (const t of tops) near(t, Zf('agent') + DEFAULT_SIZE.L.d / 2 + FLOW.slotDrop, 'all children start one slotDrop behind the parent');
  const rowL = X(m, 'model') - DEFAULT_SIZE.M.w / 2, rowR = X(m, 'pdf') + DEFAULT_SIZE.M.w / 2;
  near((rowL + rowR) / 2, X(m, 'agent'), 'the row is centred under the agent');
  for (const u of ['budget', 'meter']) assert.ok(Zf(u) < Zf('trigger') - DEFAULT_SIZE.S.d / 2, `${u} behind the chain`);
  near(Zf('budget'), Zf('meter'), 'one top row'); near(X(m, 'budget') - DEFAULT_SIZE.M.w / 2, X(m, 'trigger') - DEFAULT_SIZE.S.w / 2, 'left-aligned with the first column');
  assert.deepEqual(overlapping(nodes, m), []);
  // the same x for the chain in both modes: the levels only move things vertically
  const m3 = flowLayout(nodes, connections);
  for (const u of [...CHAIN, ...KIDS]) near(X(m3, u), X(m, u), `${u} keeps its x across modes`);
});

test('deterministic and pure: the same input gives the same map; the input is untouched; opts move the anchor', () => {
  const a = sample(), b = sample();
  const m1 = flowLayout(a.nodes, a.connections), m2 = flowLayout(b.nodes, b.connections);
  assert.deepEqual([...m1], [...m2]);
  assert.deepEqual(a, sample(), 'nodes / connections are not mutated');
  const shifted = flowLayout(a.nodes, a.connections, { anchor: { x: 10, z: -5 } });
  for (const [u, p] of m1) assert.deepEqual(shifted.get(u), [+(p[0] + 10).toFixed(3), p[1], +(p[2] - 5).toFixed(3)]);
  const flat1 = flowLayout(a.nodes, a.connections, { flat: true }), flat2 = flowLayout(b.nodes, b.connections, { flat: true });
  assert.deepEqual([...flat1], [...flat2]);
  assert.equal(flowLayout([], []).size, 0);
});

test('parallel branches spread in z inside a column, ordered by their predecessors; loose blocks get a trailing column; cycles do not hang', () => {
  const nodes = [N('a', 'input', 'S'), N('b1', 'gw-tool'), N('b2', 'gw-tool'), N('c', 'log'), N('loose', 'text', 'S')];
  const connections = [{ from: 'a', to: 'b1', toKey: 'trigger' }, { from: 'a', to: 'b2', toKey: 'trigger' }, { from: 'b1', to: 'c', toKey: 'trigger' }, { from: 'b2', to: 'c', toKey: 'in' }];
  for (const flat of [false, true]) {
    const m = flowLayout(nodes, connections, { flat }); const Zm = (u) => m.get(u)[flat ? 1 : 2];
    near(X(m, 'b1'), X(m, 'b2'), 'same column'); assert.ok(Zm('b1') < Zm('b2'), 'first cable first');
    near(Zm('b2') - Zm('b1'), DEFAULT_SIZE.M.d + FLOW.rowGap, 'row gap');
    near(Zm('c'), 0, 'chain row'); near((Zm('b1') + Zm('b2')) / 2, 0, 'branches centred on the chain');
    assert.ok(X(m, 'loose') > X(m, 'c'), 'a loose block lands in a trailing column');
    if (!flat) for (const u of ['a', 'b1', 'b2', 'c', 'loose']) near(Y(m, u), LEVELS.flow, `${u} at the flow level`);
    assert.deepEqual(overlapping(nodes, m), []);
  }
  const cyc = flowLayout([N('p', 'x'), N('q', 'x')], [{ from: 'p', to: 'q', toKey: 'in' }, { from: 'q', to: 'p', toKey: 'in' }]);
  assert.equal(cyc.size, 2); assert.ok(Number.isFinite(X(cyc, 'p')) && Number.isFinite(X(cyc, 'q')));
});

test('nested slot children: a child of a floor-standing child has no room below, so it steps forward in z on the floor; a child too tall for the gap steps forward too; a child cabled into two parents keeps the first', () => {
  const nodes = [N('agent', 'gw-agent', 'L'), N('t', 'gw-tool'), N('sub', 'gw-llm'), N('other', 'gw-agent', 'L')];
  const connections = [{ from: 't', to: 'agent', toKey: 'tools' }, { from: 'sub', to: 't', toKey: 'model' }, { from: 't', to: 'other', toKey: 'tools' }];
  const m = flowLayout(nodes, connections);
  assert.ok(Y(m, 't') < Y(m, 'agent') && Math.abs(Z(m, 't') - Z(m, 'agent')) <= 1.2, 'the tool stands under the agent');
  near(Y(m, 'sub'), Y(m, 't'), 'the grandchild is on the floor as well'); assert.ok(Z(m, 'sub') > Z(m, 't') + DEFAULT_SIZE.M.d / 2, 'and steps forward in front of its parent');
  near(X(m, 't'), X(m, 'agent'), 'single children sit centred under their parent'); near(X(m, 'sub'), X(m, 't'), 'nested too');
  assert.deepEqual(overlapping(nodes, m), []);
  const flat = flowLayout(nodes, connections, { flat: true });
  assert.ok(flat.get('t')[1] > flat.get('agent')[1] && flat.get('sub')[1] > flat.get('t')[1], 'flat: one level further behind each time');
  // a child too tall to stand under a low parent steps forward instead of overlapping it
  const tall = [N('p', 'gw-agent', 'XL'), N('k', 'gw-tool', 'XL')];
  const m2 = flowLayout(tall, [{ from: 'k', to: 'p', toKey: 'tools' }], { levels: { flow: 7 } });
  assert.ok(Z(m2, 'k') > Z(m2, 'p') + DEFAULT_SIZE.XL.d / 2, 'forward'); near(Y(m2, 'k') - DEFAULT_SIZE.XL.h / 2, LEVELS.ground, 'still on the floor');
  assert.deepEqual(overlapping(tall, m2), []);
});

test('overlapping() reads boxes: blocks apart on y alone are clear in 3D, and [x, z] pairs still check plan footprints', () => {
  const nodes = [N('a', 'x'), N('b', 'x')];
  assert.deepEqual(overlapping(nodes, new Map([['a', [0, 9, 0]], ['b', [0, 2, 0]]])), []);
  assert.deepEqual(overlapping(nodes, new Map([['a', [0, 9, 0]], ['b', [0, 9.5, 0]]])), [['a', 'b']]);
  assert.deepEqual(overlapping(nodes, new Map([['a', [0, 0]], ['b', [1, 1]]])), [['a', 'b']]);
  assert.deepEqual(overlapping(nodes, new Map([['a', [0, 0]], ['b', [DEFAULT_SIZE.M.w, 0]]])), []);
});
