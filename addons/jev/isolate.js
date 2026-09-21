// isolate.js — the add-on page must never write the core page's project storage. main.js boots the
// project tabs (localStorage `proto3d.tabs.v1`, IndexedDB `proto3d-projects`) and the Start panel
// before any add-on code can reach the instances, so the seams are patched on the prototypes first.
// Every patch is a *private* method of the core (named here so a reviewer can find them):
//   Tabs.prototype.init       → never restores the core's tabs into this page (and never reads them)
//   Tabs.prototype._writeKey  → never writes `proto3d.tabs.v1`
//   Tabs.prototype._persist   → never writes a project record into IndexedDB
//   Tabs.prototype.saveNow    → autosave is a no-op here (plugin.js also flips `autosaveOn` off)
//   StartPanel.prototype.open → the Start panel never renders (its thumbnails would 404 from this folder);
//                               plugin.js points it at the tutorial instead
// Nothing else is patched; the world, engine, menus and panel run untouched.
import { Tabs } from '../../src/tabs.js';
import { StartPanel } from '../../src/ui/start-panel.js';

/** Replace a prototype method only when the core still has it; a renamed seam is reported, never invented. */
function patch(proto, name, fn) {
  if (typeof proto?.[name] !== 'function') { console.warn(`jev/isolate: ${name} is not a method of the core any more — check the isolation before using this page`); return false; }
  proto[name] = fn; return true;
}
patch(Tabs.prototype, 'init', async function init() { try { await this.store?.ready; } catch (_) { /* no store */ } return false; });
patch(Tabs.prototype, '_writeKey', function noWriteKey() {});
patch(Tabs.prototype, '_persist', async function noPersist() { return true; });
patch(Tabs.prototype, 'saveNow', async function noSave() { clearTimeout(this._t); this._t = 0; this._setStatus?.('off', { reason: 'addon' }); return false; });
patch(StartPanel.prototype, 'open', function noStart(reason) { this.onChange?.(false, reason); });

export const ISOLATED = true;
