// ai/ui-hooks.js — the AI layer and the Generate components live below the UI. When a face or a
// panel needs to open the Connections page or the model browser it calls these hooks; main.js
// installs the real implementations (`setUIHooks`). Without a UI (tests, headless) they are
// harmless no-ops that return false.
const hooks = {
  openConnections: () => false,        // (providerId?) → opens the Connections modal
  openModelBrowser: () => false,       // ({ kind, providerId, current, onPick }) → opens the model browser
  focusBlock: () => false,             // (uid) → frames + selects a block (job tray click)
  toast: () => false,                  // (text, ms)
};
export function setUIHooks(h) { Object.assign(hooks, h); }
export const ui = hooks;
export default hooks;
