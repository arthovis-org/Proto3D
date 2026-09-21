// flowLayout: pure and deterministic — ranks left to right, branches top-down, slot children
// hung below their parent, budget / meter in a top row, no overlaps on the sample-shaped graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowLayout, overlapping, slotChildren, isSlotKey, sizeOf, DEFAULT_SIZE, FLOW } from '../../src/flowLayout.js';

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
const X = (m, u) => m.get(u)[0], Z = (m, u) => m.get(u)[1];

test('slot keys and defaults', () => {
  for (const k of ['model', 'memory', 'tools', 'tool', 'tool1', 'tool3']) assert.ok(isSlotKey(k), k);
  for (const k of ['trigger', 'prompt', 'in', 'toolbox', '', undefined]) assert.ok(!isSlotKey(k), String(k));
  assert.deepEqual(sizeOf({ size: 'L' }), DEFAULT_SIZE.L); assert.deepEqual(sizeOf({ size: 'M', w: 5, d: 4 }), { w: 5, d: 4 }); assert.deepEqual(sizeOf({}), DEFAULT_SIZE.S);
  const { parentOf, kids } = slotChildren(sample().nodes, sample().connections);
  assert.deepEqual(kids.get('agent'), ['model', 'memory', 'search', 'crawl', 'pdf']); assert.equal(parentOf.get('pdf'), 'agent'); assert.ok(!parentOf.has('draft'));
});

test('the main chain runs left → right by rank with equal column gaps; slot children hang below the agent, centred, one step down; budget and meter sit on top', () => {
  const { nodes, connections } = sample();
  const m = flowLayout(nodes, connections);
  assert.equal(m.size, nodes.length, 'every node gets a position');
  // ranks
  assert.ok(X(m, 'trigger') < X(m, 'agent') && X(m, 'agent') < X(m, 'draft') && X(m, 'draft') < X(m, 'log'), 'left to right');
  const gapAgentDraft = (X(m, 'draft') - DEFAULT_SIZE.M.w / 2) - (X(m, 'agent') + Math.max(DEFAULT_SIZE.L.w, 0) / 2);
  const gapDraftLog = (X(m, 'log') - DEFAULT_SIZE.M.w / 2) - (X(m, 'draft') + DEFAULT_SIZE.M.w / 2);
  assert.ok(Math.abs(gapDraftLog - FLOW.colGap) < 1e-6, `column gap ${gapDraftLog}`);
  assert.ok(gapAgentDraft >= FLOW.colGap - 1e-6, 'the agent column is as wide as its row of slot children');
  // chain on one row
  for (const u of ['trigger', 'agent', 'draft', 'log']) assert.ok(Math.abs(Z(m, u)) < 1e-6, `${u} on the chain row (z ${Z(m, u)})`);
  // slot children: below the parent, one step down, centred under it, in a row, in connection order
  const kids = ['model', 'memory', 'search', 'crawl', 'pdf'];
  for (const k of kids) assert.ok(Z(m, k) > Z(m, 'agent') + DEFAULT_SIZE.L.d / 2, `${k} hangs below the agent`);
  const tops = kids.map((k) => Z(m, k) - sizeOf(nodes.find((n) => n.uid === k)).d / 2);
  for (const t of tops) assert.ok(Math.abs(t - (Z(m, 'agent') + DEFAULT_SIZE.L.d / 2 + FLOW.slotDrop)) < 1e-6, 'all children start one slotDrop under the parent');
  for (let i = 1; i < kids.length; i++) assert.ok(X(m, kids[i]) > X(m, kids[i - 1]), 'children left to right in slot order');
  const rowL = X(m, 'model') - DEFAULT_SIZE.M.w / 2, rowR = X(m, 'pdf') + DEFAULT_SIZE.M.w / 2;
  assert.ok(Math.abs((rowL + rowR) / 2 - X(m, 'agent')) < 1e-6, 'the row is centred under the agent');
  // top row
  for (const u of ['budget', 'meter']) assert.ok(Z(m, u) < Z(m, 'trigger') - DEFAULT_SIZE.S.d / 2, `${u} above the chain`);
  assert.ok(X(m, 'budget') < X(m, 'meter')); assert.ok(Math.abs(Z(m, 'budget') - Z(m, 'meter')) < 1e-6);
  assert.ok(Math.abs((X(m, 'budget') - DEFAULT_SIZE.M.w / 2) - (X(m, 'trigger') - DEFAULT_SIZE.S.w / 2)) < 1e-6, 'left-aligned with the first column');
  // clean
  assert.deepEqual(overlapping(nodes, m), []);
});

test('deterministic and pure: the same input gives the same map; the input is untouched; opts move the anchor', () => {
  const a = sample(), b = sample();
  const m1 = flowLayout(a.nodes, a.connections), m2 = flowLayout(b.nodes, b.connections);
  assert.deepEqual([...m1], [...m2]);
  assert.deepEqual(a, sample(), 'nodes / connections are not mutated');
  const shifted = flowLayout(a.nodes, a.connections, { anchor: { x: 10, z: -5 } });
  for (const [u, p] of m1) assert.deepEqual(shifted.get(u), [+(p[0] + 10).toFixed(3), +(p[1] - 5).toFixed(3)]);
  assert.equal(flowLayout([], []).size, 0);
});

test('parallel branches stack top → down inside a column, ordered by their predecessors; loose blocks get a trailing column; cycles do not hang', () => {
  const nodes = [N('a', 'input', 'S'), N('b1', 'gw-tool'), N('b2', 'gw-tool'), N('c', 'log'), N('loose', 'text', 'S')];
  const connections = [{ from: 'a', to: 'b1', toKey: 'trigger' }, { from: 'a', to: 'b2', toKey: 'trigger' }, { from: 'b1', to: 'c', toKey: 'trigger' }, { from: 'b2', to: 'c', toKey: 'in' }];
  const m = flowLayout(nodes, connections);
  assert.ok(Math.abs(X(m, 'b1') - X(m, 'b2')) < 1e-6, 'same column'); assert.ok(Z(m, 'b1') < Z(m, 'b2'), 'first cable on top');
  assert.ok(Math.abs(Z(m, 'b2') - Z(m, 'b1') - (DEFAULT_SIZE.M.d + FLOW.rowGap)) < 1e-6, 'row gap');
  assert.ok(Math.abs(Z(m, 'c')) < 1e-6 && Math.abs((Z(m, 'b1') + Z(m, 'b2')) / 2) < 1e-6, 'branches centred on the chain');
  assert.ok(X(m, 'loose') > X(m, 'c'), 'a loose block lands in a trailing column');
  assert.deepEqual(overlapping(nodes, m), []);
  const cyc = flowLayout([N('p', 'x'), N('q', 'x')], [{ from: 'p', to: 'q', toKey: 'in' }, { from: 'q', to: 'p', toKey: 'in' }]);
  assert.equal(cyc.size, 2); assert.ok(Number.isFinite(X(cyc, 'p')) && Number.isFinite(X(cyc, 'q')));
});

test('nested slot children (a tool under a tool) hang one level further down; a child cabled into two parents keeps the first', () => {
  const nodes = [N('agent', 'gw-agent', 'L'), N('t', 'gw-tool'), N('sub', 'gw-llm'), N('other', 'gw-agent', 'L')];
  const connections = [{ from: 't', to: 'agent', toKey: 'tools' }, { from: 'sub', to: 't', toKey: 'model' }, { from: 't', to: 'other', toKey: 'tools' }];
  const m = flowLayout(nodes, connections);
  assert.ok(Z(m, 't') > Z(m, 'agent') && Z(m, 'sub') > Z(m, 't'));
  assert.ok(Math.abs(X(m, 't') - X(m, 'agent')) < 1e-6 && Math.abs(X(m, 'sub') - X(m, 't')) < 1e-6, 'single children sit centred under their parent');
  assert.deepEqual(overlapping(nodes, m), []);
});
