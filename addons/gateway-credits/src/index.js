// index.js — the add-on entry the SDK shell (and the tests) call:
//   register(host)  before the core boots: create the ledger over host.storage, register the
//                   four gw- node types (so an autosaved graph with them is restored, not skipped)
//   install(host)   after the core booted: hooks (engine.onError, world.onChange), toasts, the
//                   Credits menu, the admin block, the sample graph on an empty page, window.__gateway
// Only ../sdk/** and this directory are imported; the core is reached through `host`.
import { createLedger, fmt, fmtBal } from './ledger.js';
import { registerNodes, kick, GATEWAY_TYPES, RUNNABLE_TYPES } from './nodes.js';
import { flowLayout } from './flowLayout.js';
import { installAdmin } from './admin.js';
import { configureSimulation, sim } from './providers.js';
import example from './example.js';

let ledger = null;

export function register(host) {
  if (ledger) return ledger;
  ledger = createLedger(host.storage);
  registerNodes(host, ledger);
  return ledger;
}

/**
 * @param {object} host   the SDK host
 * @param {object} opts   { sample: true } builds the bundled sample graph when the page is empty
 *                        (needs the core components Input / Text / Log, so headless tests pass false)
 */
export function install(host, { sample = true } = {}) {
  if (!ledger) register(host);
  const toast = (t, ms) => host.ui.toast(t, ms);

  /* ---- 1. sample graph: a fresh page (nothing restored from this page's own storage) gets the demo graph ---- */
  const canBuildSample = () => ['input', 'log'].every((id) => host.nodes.has(id));
  function loadSample() {
    if (!canBuildSample()) { toast('Sample needs the core Input / Log components'); return null; }
    const named = host.examples.build(example, { name: example.label });
    try { host.ui.wiring(true); } catch (_) { /* older core: cables follow the user's switch */ }   // the flow reads by its cables (slot drop-lines under the agent), so show them
    return named;
  }
  if (sample && host.world.nodes().length === 0 && canBuildSample()) loadSample();

  /* ---- 2. hold hygiene: engine errors and removed nodes release their holds ---- */
  host.engine.onError((node, e) => {
    if (!GATEWAY_TYPES.includes(node.typeId)) return;
    const n = ledger.releaseHolds(node.uid, `engine error: ${e?.message || e} · hold released`);
    if (n) toast(`${node.title}: ${n} hold${n > 1 ? 's' : ''} released after an error`, 2400);
  });
  host.world.onChange((what) => {
    if (what !== 'remove-node' && what !== 'clear' && what !== 'load' && what !== 'example') return;
    const alive = new Set(host.world.nodes().map((n) => n.uid));
    for (const hd of ledger.openHolds()) if (!alive.has(hd.nodeUid)) ledger.refund(hd.holdId, 'node removed · hold released');
  });

  /* ---- 3. toasts for the metering lifecycle ---- */
  ledger.on((type, e) => {
    switch (type) {
      case 'hold': toast(`Held ${fmt(e.credits)} cr · ${e.nodeTitle} → ${e.provider}`); break;
      case 'settle': toast(`Settled ${fmt(e.credits)} cr · ${e.nodeTitle} · balance ${fmtBal(ledger.available())} cr`); break;
      case 'refund': toast(`Refunded · ${e.nodeTitle} · ${e.note}`, 2400); break;
      case 'decline': toast(`Declined · ${e.nodeTitle || 'request'} · ${e.note}`, 3600); break;
      case 'bypass': toast(`${e.nodeTitle}: own key, not metered (0 cr)`); break;
      case 'topup': toast(`Top-up +${fmtBal(e.credits)} cr · balance ${fmtBal(ledger.available())} cr`); break;
      case 'auto-topup': toast(`Auto top-up fired: +${fmtBal(e.credits)} cr`, 3000); break;
      case 'adjust': toast(`Balance adjusted to ${fmtBal(ledger.available())} cr`); break;
      default: break;
    }
  });

  /* ---- 4. Flow layout: the three-level arrangement (flowLayout.js, pure) applied as one undoable move through the SDK.
          `flat` gives the ground-plane variant for the 2D plan (children behind their parent, y kept); it is the default while the plan is on ---- */
  const planOn = () => { try { return !!host.ui.plan?.(); } catch (_) { return false; } };
  function applyFlowLayout({ frame = true, flat } = {}) {
    const g = host.layout.graph();
    if (!g.nodes.length) { toast('Nothing to lay out'); return 0; }
    const isFlat = flat ?? planOn();
    const positions = flowLayout(g.nodes, g.connections, { flat: isFlat });
    const moved = host.layout.apply(positions, { label: isFlat ? 'Flow layout (flat)' : 'Flow layout', frame });
    if (moved) toast(isFlat ? `Flow layout (flat) · ${moved} block${moved === 1 ? '' : 's'} arranged left → right, sub-nodes behind their agent` : `Flow layout · ${moved} block${moved === 1 ? '' : 's'} on three levels: budget / meter above, the flow at eye level, sub-nodes on the floor under their agent`, 2200);
    return moved;
  }

  /* ---- 5. "Run sample": pulse the Input feeding the first runnable gateway node (the agent first), else kick it; then tidy the flow ---- */
  function runSample({ layout = true } = {}) {
    const order = host.engine.order();
    const gws = RUNNABLE_TYPES.flatMap((t) => order.filter((n) => n.typeId === t));
    if (!gws.length) { toast('No gateway node in the graph — add one from the Gateway category'); return false; }
    // the first runnable node in evaluation order whose trigger is not fed by another gateway node (the head of the chain); the agent wins ties
    const fedByGateway = (n) => host.world.connections().some((c) => c.to && c.to.owner === n && c.to.key === 'trigger' && GATEWAY_TYPES.includes(c.from.owner.typeId));
    const first = gws.find((n) => !fedByGateway(n)) || gws[0];
    let ok = false;
    const up = host.world.connections().find((c) => c.to && c.to.owner === first && c.to.key === 'trigger' && c.from.type === 'event');
    if (up) {
      const src = up.from.owner;
      if (src.typeId === 'input') { src.state.count = (src.state.count || 0) + 1; src.state.pressedAt = typeof performance !== 'undefined' ? performance.now() : Date.now(); src.faceDirty = true; }   // pressedAt: the core Input face compares it against performance.now()
      ok = host.engine.emit(src, up.from.key, 'sample run');
    }
    if (!ok) ok = kick(first);
    if (ok && layout) { try { applyFlowLayout({ frame: true }); } catch (e) { console.warn('[gateway-credits] flow layout skipped:', e?.message || e); } }
    return ok;
  }

  /* ---- 6. Credits menu + admin block (DOM; skipped in headless tests where document is absent) ---- */
  const ui = typeof document !== 'undefined' ? installAdmin(host, { ledger, runSample, loadSample, applyFlowLayout }) : null;

  const api = { ledger, runSample, loadSample, applyFlowLayout, flowLayout, kick, example, GATEWAY_TYPES, RUNNABLE_TYPES, admin: ui?.admin || null, menu: ui?.menu || null, host, configureSimulation, sim };
  if (typeof window !== 'undefined') window.__gateway = api;
  return api;
}

export { ledger as currentLedger, example, GATEWAY_TYPES, kick };
