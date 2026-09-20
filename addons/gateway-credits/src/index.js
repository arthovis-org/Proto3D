// index.js — the add-on entry the SDK shell (and the tests) call:
//   register(host)  before the core boots: create the ledger over host.storage, register the
//                   four gw- node types (so an autosaved graph with them is restored, not skipped)
//   install(host)   after the core booted: hooks (engine.onError, world.onChange), toasts, the
//                   Credits menu, the admin block, the sample graph on an empty page, window.__gateway
// Only ../sdk/** and this directory are imported; the core is reached through `host`.
import { createLedger, fmt, fmtBal } from './ledger.js';
import { registerNodes, kick, GATEWAY_TYPES } from './nodes.js';
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
  const canBuildSample = () => ['input', 'text', 'log'].every((id) => host.nodes.has(id));
  function loadSample() {
    if (!canBuildSample()) { toast('Sample needs the core Input / Text / Log components'); return null; }
    return host.examples.build(example, { name: example.label });
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

  /* ---- 4. "Run sample": pulse the Input feeding the first gateway node, else kick the node directly ---- */
  function runSample() {
    const gws = host.engine.order().filter((n) => n.typeId === 'gw-llm' || n.typeId === 'gw-tool');
    if (!gws.length) { toast('No gateway node in the graph — add one from the Gateway category'); return false; }
    const first = gws[0];
    const up = host.world.connections().find((c) => c.to && c.to.owner === first && c.to.key === 'trigger' && c.from.type === 'event');
    if (up) {
      const src = up.from.owner;
      if (src.typeId === 'input') { src.state.count = (src.state.count || 0) + 1; src.state.pressedAt = Date.now(); src.faceDirty = true; }
      if (host.engine.emit(src, up.from.key, 'sample run')) return true;
    }
    return kick(first);
  }

  /* ---- 5. Credits menu + admin block (DOM; skipped in headless tests where document is absent) ---- */
  const ui = typeof document !== 'undefined' ? installAdmin(host, { ledger, runSample, loadSample }) : null;

  const api = { ledger, runSample, loadSample, kick, example, GATEWAY_TYPES, admin: ui?.admin || null, menu: ui?.menu || null, host, configureSimulation, sim };
  if (typeof window !== 'undefined') window.__gateway = api;
  return api;
}

export { ledger as currentLedger, example, GATEWAY_TYPES, kick };
