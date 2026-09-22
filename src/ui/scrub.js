// ui/scrub.js — horizontal click-drag scrubbing for number fields (Blender-style). The field is
// horizontal, so dragging along X changes the value: every PX_PER_STEP px is one step, Shift is
// coarse (×10), Alt fine (×0.1), Escape restores the start value. A plain click (no movement)
// still focuses the field and selects its text so typing works as before; a focused field is
// left to the browser (caret and text selection), so scrubbing only starts from an unfocused one.
export const PX_PER_STEP = 6;
const THRESHOLD = 3;

/** Decimals a value should keep for `step` (same rule as the face field editor's arrow keys). */
export function decimalsFor(step) { return Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1)); }

/**
 * attachScrub(input, { step, min, max, get, set, keepFocus })
 *  - `get()` → the current number, `set(v)` writes one (callers coalesce their history entries).
 *  - `keepFocus`: the field stays focused (the face editor owns focus and commits on blur), the
 *    press is swallowed instead so no text selection starts. Returns a detach function.
 */
export function attachScrub(input, { step = 0.1, min, max, get, set, keepFocus = false } = {}) {
  let s = null;   // { id, x0, v0, wasFocused, active, last }
  const stepNow = () => { const v = typeof step === 'function' ? step() : step; return Number.isFinite(v) && v > 0 ? v : 0.1; };
  const clamp = (v) => { if (Number.isFinite(min)) v = Math.max(min, v); if (Number.isFinite(max)) v = Math.min(max, v); return v; };
  const end = () => {
    if (!s) return;
    if (s.active) {
      try { input.releasePointerCapture(s.id); } catch (_) { /* already released */ }
      input.classList.remove('scrubbing');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      window.removeEventListener('keydown', onKey, true);
    }
    s = null;
  };
  const apply = (v) => { if (v === s.last) return; s.last = v; input.value = String(v); set(v); };
  const onKey = (e) => { if (e.key !== 'Escape' || !s?.active) return; e.preventDefault(); e.stopPropagation(); apply(s.v0); end(); };
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || input.disabled || input.readOnly) return;
    const wasFocused = document.activeElement === input;
    if (wasFocused && !keepFocus) return;   // a focused field belongs to the caret
    const v0 = Number(get());
    s = { id: e.pointerId, x0: e.clientX, v0: Number.isFinite(v0) ? v0 : 0, wasFocused, active: false, last: undefined };
    if (keepFocus) e.preventDefault();      // no native text selection under the scrub
  });
  input.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    if (!s.active) {
      if (Math.abs(dx) <= THRESHOLD) return;
      s.active = true;
      try { input.setPointerCapture(e.pointerId); } catch (_) { /* unsupported */ }
      input.classList.add('scrubbing');
      document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
      if (!keepFocus) input.blur();
      window.addEventListener('keydown', onKey, true);
    }
    e.preventDefault();
    const st = stepNow() * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
    apply(+clamp(s.v0 + Math.round(dx / PX_PER_STEP) * st).toFixed(decimalsFor(st)));
  });
  const onUp = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const plainClick = !s.active && e.type === 'pointerup';
    end();
    if (plainClick && !keepFocus) { input.focus({ preventScroll: true }); input.select(); }
  };
  input.addEventListener('pointerup', onUp);
  input.addEventListener('pointercancel', onUp);
  input.addEventListener('lostpointercapture', () => { if (s?.active) end(); });
  return end;
}
