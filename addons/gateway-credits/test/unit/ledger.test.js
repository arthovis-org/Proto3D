import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, memoryStore, OPENING_BALANCE, LEDGER_KEY, SETTINGS_KEY, fmt, fmtBal } from '../../src/ledger.js';

const req = (over = {}) => ({ idem: 'n1:p1', nodeUid: 'n1', nodeTitle: 'Summarize', workflow: 'wf', providerId: 'anthropic', provider: 'Anthropic · Claude Sonnet 4.5', service: 'Claude Sonnet 4.5', units: 'est.', credits: 1.5, ...over });

test('opens with the demo balance and persists the opening row under the add-on storage keys', () => {
  const store = memoryStore();
  const l = createLedger(store);
  assert.equal(l.available(), OPENING_BALANCE); assert.equal(l.balance(), OPENING_BALANCE); assert.equal(l.held(), 0);
  assert.deepEqual(store.keys(), [LEDGER_KEY]);
  assert.equal(store.get(LEDGER_KEY).length, 1); assert.equal(store.get(LEDGER_KEY)[0].kind, 'open');
  assert.throws(() => createLedger(null), /storage with get/);
});

test('hold → settle: balance derives from entries, holds reduce what is available', () => {
  const l = createLedger(memoryStore());
  const h = l.hold(req());
  assert.equal(h.ok, true); assert.ok(h.holdId); assert.equal(h.estimate, 1.5);
  assert.equal(l.held(), 1.5); assert.equal(l.available(), OPENING_BALANCE - 1.5); assert.equal(l.balance(), OPENING_BALANCE, 'a hold is not spend yet');
  assert.deepEqual(l.holdsFor('n1').map((x) => x.holdId), [h.holdId]); assert.ok(l.isOpen(h.holdId));
  const s = l.settle(h.holdId, 1.2, { units: '900 in / 300 out' });
  assert.equal(s.kind, 'settle'); assert.equal(l.held(), 0); assert.equal(l.balance(), OPENING_BALANCE - 1.2); assert.equal(l.available(), OPENING_BALANCE - 1.2);
  assert.equal(l.spend(), 1.2); assert.equal(l.lastCost(), 1.2); assert.equal(l.lastCostFor('n1'), 1.2); assert.equal(l.requests(), 1); assert.equal(l.avgPerCall(), 1.2);
  assert.equal(l.settle(h.holdId, 5), null, 'settling a closed hold is a no-op'); assert.equal(l.refund(h.holdId), null, 'refunding a settled hold is a no-op');
  const rows = l.rows(); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'settled'); assert.equal(rows[0].credits, 1.2); assert.equal(rows[0].units, '900 in / 300 out');
});

test('hold → refund releases the money; releaseHolds(nodeUid) refunds every open hold of a node', () => {
  const l = createLedger(memoryStore());
  const a = l.hold(req({ idem: 'a' })), b = l.hold(req({ idem: 'b', credits: 2 })), c = l.hold(req({ idem: 'c', nodeUid: 'n2' }));
  assert.equal(l.held(), 5);
  l.refund(a.holdId, 'provider 503 · hold released');
  assert.equal(l.held(), 3.5); assert.equal(l.balance(), OPENING_BALANCE);
  assert.equal(l.releaseHolds('n1', 'node removed'), 1); assert.equal(l.held(), 1.5); assert.ok(l.isOpen(c.holdId));
  const statuses = l.rows().map((r) => r.status); assert.deepEqual(statuses, ['held', 'refunded', 'refunded']);
  void b;
});

test('idempotency: the same key never holds twice; settle / refund / bypass / decline stay visible as rows', () => {
  const l = createLedger(memoryStore());
  const first = l.hold(req({ idem: 'k1' })); const again = l.hold(req({ idem: 'k1' }));
  assert.equal(first.ok, true); assert.deepEqual(again, { ok: true, duplicate: true }); assert.equal(l.openHolds().length, 1);
  assert.ok(l.hasIdem('k1')); assert.ok(!l.hasIdem('k2'));
  assert.ok(l.bypass(req({ idem: 'k2', credits: 0 }))); assert.equal(l.bypass(req({ idem: 'k2' })), null, 'a bypass with a seen key is dropped');
  assert.equal(l.bypassed(), 1); assert.equal(l.requests(), 1, 'bypasses count as requests');
  l.decline(req({ idem: 'k3' }), 'not eligible');
  assert.deepEqual(l.rows().map((r) => r.status), ['decline', 'bypassed', 'held']);
  assert.equal(l.available(), OPENING_BALANCE - 1.5);
});

test('declines: insufficient balance (auto top-up off) and a workflow budget reached', () => {
  const l = createLedger(memoryStore());
  l.adjustTo(0.5, 'set to 0.5 for testing');
  assert.equal(+l.available().toFixed(4), 0.5);
  const d = l.hold(req({ idem: 'd1', credits: 1.5 }));
  assert.equal(d.ok, false); assert.match(d.reason, /insufficient balance: est 1\.500 cr, available 0\.5000 cr \(auto top-up is off\)/); assert.equal(d.entry.kind, 'decline');
  assert.equal(l.openHolds().length, 0);
  l.topUp(500);
  const okHold = l.hold(req({ idem: 'b1', credits: 30, budget: { limit: 50, period: 'monthly' } })); assert.equal(okHold.ok, true);
  const overBudget = l.hold(req({ idem: 'b2', credits: 30, budget: { limit: 50, period: 'monthly' } }));
  assert.equal(overBudget.ok, false); assert.match(overBudget.reason, /workflow budget 50\.000 cr \(monthly\) reached: spent 30\.000, est 30\.000/);
  l.settle(okHold.holdId, 25);
  assert.equal(l.spentFor('wf'), 25); assert.equal(l.heldFor('wf'), 0);
  const ok2 = l.hold(req({ idem: 'b3', credits: 20, budget: { limit: 50, period: 'monthly' } })); assert.equal(ok2.ok, true, '25 spent + 20 est ≤ 50');
  const rows = l.rows(); assert.equal(rows.filter((r) => r.status === 'decline').length, 2); assert.equal(rows.find((r) => r.status === 'adjust').credits, +(0.5 - OPENING_BALANCE).toFixed(4));
});

test('auto top-up fires when a hold would fail, respects the monthly cap, and shows as a row', () => {
  const store = memoryStore(); const l = createLedger(store);
  l.settings.autoTopUp = { enabled: true, threshold: 100, target: 1000, monthlyCap: 1500 }; l.saveSettings();
  assert.deepEqual(store.get(SETTINGS_KEY).autoTopUp, { enabled: true, threshold: 100, target: 1000, monthlyCap: 1500 });
  l.adjustTo(0.5);
  const events = []; l.on((t) => events.push(t));
  const h = l.hold(req({ idem: 't1', credits: 1.5 }));
  assert.equal(h.ok, true); assert.ok(events.includes('auto-topup')); assert.ok(events.indexOf('auto-topup') < events.indexOf('hold'));
  assert.equal(+l.autoToppedThisMonth().toFixed(4), 999.5); assert.equal(+l.available().toFixed(4), 998.5);
  assert.equal(l.rows()[1].status, 'topup', 'auto top-ups render as top-up rows'); assert.match(l.rows()[1].note, /auto top-up fired/);
  // cap: only 500.5 left this month
  l.adjustTo(0.5);
  const h2 = l.hold(req({ idem: 't2', credits: 1000 }));
  assert.equal(h2.ok, false); assert.match(h2.reason, /auto top-up could not cover it/); assert.equal(+l.autoToppedThisMonth().toFixed(4), 1500);
  const capped = []; l.on((t) => capped.push(t)); l.adjustTo(0.5); l.maybeAutoTopUp(); assert.ok(capped.includes('auto-topup-capped'));
});

test('a second ledger over the same storage sees the same entries and settings (persistence round-trip)', () => {
  const store = memoryStore(); const l = createLedger(store);
  const h = l.hold(req()); l.settle(h.holdId, 1); l.settings.policy.preferCheapest = true; l.saveSettings();
  const l2 = createLedger(store);
  assert.equal(l2.available(), OPENING_BALANCE - 1); assert.equal(l2.entries.length, 3); assert.equal(l2.settings.policy.preferCheapest, true); assert.equal(l2.settings.policy.fallback, true, 'defaults fill missing settings');
  l2.reset(); assert.equal(l2.available(), OPENING_BALANCE); assert.equal(createLedger(store).entries.length, 1);
});

test('periods, grouping and formatting helpers', () => {
  let t = new Date('2026-09-20T10:00:00Z');
  const l = createLedger(memoryStore(), { now: () => t });
  const s1 = l.hold(req({ idem: 'a', workflow: 'A', service: 'Brave Search', providerId: 'brave' })); l.settle(s1.holdId, 0.5);
  const s2 = l.hold(req({ idem: 'b', workflow: 'B' })); l.settle(s2.holdId, 2);
  assert.deepEqual(l.byWorkflow().map((r) => [r.name, r.credits, r.n]), [['B', 2, 1], ['A', 0.5, 1]]);
  assert.deepEqual(l.byService().map((r) => r.name), ['Claude Sonnet 4.5', 'Brave Search']);
  assert.equal(l.spend('daily'), 2.5);
  t = new Date('2026-09-21T10:00:00Z'); assert.equal(l.spend('daily'), 0); assert.equal(l.spend('monthly'), 2.5);
  t = new Date('2026-10-01T10:00:00Z'); assert.equal(l.spend('monthly'), 0); assert.equal(l.spentFor('B'), 0);
  assert.equal(fmt(123.456), '123.46'); assert.equal(fmt(1.23456), '1.235'); assert.equal(fmt(0.12345), '0.1235'); assert.equal(fmtBal(2300), '2,300.00');
});
