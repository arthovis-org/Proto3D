// ui/field-editor.js — edit a face field where it is drawn. A face renderer registers editable
// regions (faces.js `beginFields`, or `body3d.fields(node)` for custom bodies); the interaction
// layer hit-tests them (`Block3D.fieldAt`), shows the hover affordance from here and opens the
// editor on a double-click (a single click on an empty field, Enter with the block selected).
//
// The editor is an HTML overlay (`#field-editor`) placed exactly over the projected region and
// re-placed every frame while open, so it follows the camera like the mini toolbar. It is typeset
// like the face: Inter, the face font size scaled to the screen (clamped 11–28 css px so it stays
// legible at any zoom — the box grows with the clamp), the face background and text colours, a
// subtle accent focus ring. Text and multiline are a textarea that grows with its content, number
// nudges with the arrow keys, select is a themed list, date a date input; a checkbox toggles at
// once without an overlay, an action runs its handler (the model chip opens the model browser).
// Enter commits (Shift+Enter is a newline in multiline), Esc cancels, blur commits, Tab / Shift+Tab
// commit and move to the next / previous field on the same block. A commit goes through the
// param command (undoable, the panel follows), the face redraws on the next frame; while the
// editor is open the block leaves that text out (`instance._editing`) so nothing doubles up.
import * as THREE from 'three';
import * as cmd from '../core/commands.js';
import { palette, typography, sizes, onThemeChange } from '../theme.js';

export const FONT_MIN = 11, FONT_MAX = 28;        // css px: the clamp on the face font scaled to the screen
const PAD = 0.35;                                  // editor padding as a fraction of the font size (the text still starts where the face text does: the box grows outward)
const LABEL_PX = 92;                               // face px per unit of a 3D label's `size` (theme.js makeLabel: 96 px glyphs on a 1.3 line)
const _c = [0, 1, 2, 3].map(() => new THREE.Vector3()), _v = new THREE.Vector3();
const KINDS = new Set(['text', 'multiline', 'number', 'select', 'date', 'checkbox', 'action']);
/** A colour with an alpha: '#rrggbb' → 'rgba(…)'; anything else is returned as is. */
export function withAlpha(c, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const same = (a, b) => (typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null) : String(a ?? '') === String(b ?? ''));
const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';

export class FieldEditor {
  /** @param {object} o { ws, world, history, selection, interaction?, overlays?, els: { editor, hover } } */
  constructor({ ws, world, history, selection, interaction = null, overlays = null, els }) {
    Object.assign(this, { ws, world, history, selection, interaction, overlays });
    this.el = els.editor; this.hoverEl = els.hover;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'Edit field');
    this.cur = null;      // { block, field, kind, input, list?, hint, err, closing, restoreTitle }
    this.hov = null;      // { block, field }
    this._last = '';      // last applied placement (skip identical style writes)
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this._offTheme = onThemeChange(() => { if (this.cur) this._style(this.cur); });
  }

  /* ---------- state ---------- */
  get active() { return !!this.cur; }
  /** The block and field being edited (tests, the mini toolbar). */
  get editing() { return this.cur ? { block: this.cur.block, field: this.cur.field } : null; }
  /** The current value of a field on a block. */
  valueOf(block, f) {
    if (f.get) return f.get(block);
    if (f.prop === 'title') return block.title;
    if (f.param) return block.params[f.param];
    return undefined;
  }
  /** Fields the keyboard walks with Tab (no checkboxes or actions). */
  tabbable(block) { return block.fields().filter((f) => f.kind !== 'checkbox' && f.kind !== 'action'); }

  /* ---------- geometry ---------- */
  /**
   * The field's projected screen rect (page px) plus `scale` = css px per face px at that spot,
   * or null when it is behind the camera. Body fields count 120 face px per unit like a face.
   */
  screenRect(block, f, camera = this.ws.camera) {
    const corners = block.fieldCorners(f, _c);
    if (!corners) return null;
    const r = this.ws.renderer.domElement.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pts = [];
    for (const c of corners) {
      _v.copy(c).project(camera);
      if (_v.z > 1) return null;
      const x = r.left + (_v.x + 1) / 2 * r.width, y = r.top + (1 - _v.y) / 2 * r.height;
      pts.push([x, y]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const edgeH = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
    const logicalH = f.rect ? f.rect.h : f.local.h * sizes.face.pxPerUnit;
    return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY, scale: edgeH / Math.max(1e-6, logicalH), vp: r };
  }
  /** Face px of the field's type (a body field may give its label `size` in units through `font.labelSize`). */
  _fontPx(f) { const F = f.font || {}; return F.size || (F.labelSize ? F.labelSize * LABEL_PX : typography.scale.label); }

  /* ---------- hover affordance ---------- */
  /** Show the faint outline over `field` on `block` (null hides it). */
  hover(block, field) {
    if (this.hov?.block === block && this.hov?.field?.id === field?.id) return;
    this.hov = block && field ? { block, field } : null;
    if (!this.hov) this.hoverEl.hidden = true; else this._placeHover();
  }
  _placeHover() {
    const h = this.hov;
    if (!h) return;
    const busy = this.cur || h.block.lodBlend > 0.5 || this.interaction?.fieldBusy || !this.world.nodes.includes(h.block);
    const fresh = busy ? null : (h.block.fields().find((f) => f.id === h.field.id) || null);
    const R = fresh ? this.screenRect(h.block, fresh) : null;
    if (!R) { this.hoverEl.hidden = true; return; }
    const pad = Math.max(2, Math.min(6, 4 * R.scale));
    this.hoverEl.hidden = false;
    this.hoverEl.style.transform = `translate(${Math.round(R.left - pad)}px, ${Math.round(R.top - pad)}px)`;
    this.hoverEl.style.width = `${Math.round(R.width + 2 * pad)}px`; this.hoverEl.style.height = `${Math.round(R.height + 2 * pad)}px`;
    this.hoverEl.title = fresh.label ? `Double-click to edit ${fresh.label}` : 'Double-click to edit';
  }

  /* ---------- open / close ---------- */
  /**
   * Open the editor on `field` of `block`. Checkboxes toggle at once, actions run, everything
   * else gets an overlay with the current value selected. Returns true when something happened.
   */
  open(block, field) {
    if (!block || !field) return false;
    const kind = KINDS.has(field.kind) ? field.kind : 'text';
    if (this.cur) { if (this.cur.block === block && this.cur.field.id === field.id) return true; let ok = false; try { ok = this._commit(); } catch (_) { ok = false; } if (!ok) this.cancel(); }
    if (!this.selection.has(block)) this.selection.set([block]);
    const api = this._api(block);
    if (kind === 'checkbox') { this._write(block, field, !this.valueOf(block, field)); return true; }
    if (kind === 'action') { field.run?.(block, api); return true; }
    const cur = { block, field, kind, closing: false, restoreTitle: false };
    block.setEditing(field.id);
    if (field.prop === 'title' && block.titleLabel) { block.titleLabel.visible = false; cur.restoreTitle = true; }
    this.hover(null, null);
    this._build(cur);
    this.cur = cur;
    this.el.hidden = false; this.el.classList.remove('bad');
    this._last = '';
    this._place();
    if (kind === 'select') cur.list.focus({ preventScroll: true });
    else { cur.input.focus({ preventScroll: true }); if (kind !== 'date') cur.input.select(); }
    return true;
  }
  /** Commit what is typed and close (false when the value is invalid: the editor stays open). */
  commit() { return this._commit(); }
  /** Close without writing. */
  cancel() { if (this.cur) this._close(); }
  /** Commit and open the next (dir 1) or previous (−1) field on the same block. */
  next(dir = 1) {
    const c = this.cur; if (!c) return false;
    const list = this.tabbable(c.block);
    const i = list.findIndex((f) => f.id === c.field.id);
    const n = list.length;
    const target = n ? list[((i < 0 ? 0 : i) + dir + n) % n] : null;
    if (!this._commit()) return false;
    if (!target || target.id === c.field.id) return true;
    const fresh = c.block.fields().find((f) => f.id === target.id) || target;
    return this.open(c.block, fresh);
  }

  _api(block) { return { history: this.history, world: this.world, selection: this.selection, overlays: this.overlays, block, cmd }; }
  /** Write a value through the field: `set`, the title command or the param command (undoable; the panel's live fields follow). */
  _write(block, f, v) {
    if (f.set) f.set(v, this._api(block));
    else if (f.prop === 'title') this.history.execute(cmd.setTitle(this.world, block, String(v ?? '')));
    else if (f.param) { const c = cmd.setParam(this.world, block, f.param, v); c.label = `Edit ${f.label || f.param}`; this.history.execute(c); }
    block.faceDirty = true;
  }
  _read(c) {
    const f = c.field, text = c.input ? c.input.value : '';
    switch (c.kind) {
      case 'number': {
        const s = text.trim().replace(',', '.');
        if (s === '') throw new Error('Enter a number');
        let v = Number(s);
        if (!Number.isFinite(v)) throw new Error('Not a number');
        if (Number.isFinite(f.min)) v = Math.max(f.min, v);
        if (Number.isFinite(f.max)) v = Math.min(f.max, v);
        return v;
      }
      case 'date': { if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Use yyyy-mm-dd'); if (text && Number.isNaN(new Date(text + 'T00:00:00Z').getTime())) throw new Error('Not a date'); return text; }
      case 'select': return c.value;
      case 'text': { const s = text.replace(/\r?\n/g, ' '); return f.parse ? f.parse(s) : s; }
      default: return f.parse ? f.parse(text) : text;
    }
  }
  _commit() {
    const c = this.cur; if (!c) return true;
    let v;
    try { v = this._read(c); } catch (e) { this._error(c, e.message); return false; }
    const err = c.field.validate ? c.field.validate(v, c.block) : null;
    if (err) { this._error(c, err); return false; }
    const before = this.valueOf(c.block, c.field);
    if (!same(v, before) && !(isEmpty(v) && isEmpty(before))) {   // an unchanged value leaves no history entry
      try { this._write(c.block, c.field, v); }
      catch (e) { this._error(c, e.message || 'Could not save'); return false; }   // a broken setter never leaves the editor stuck
    }
    this._close();
    return true;
  }
  _error(c, message) {
    this.el.classList.add('bad');
    c.err.textContent = message; c.err.hidden = false;
    c.input?.focus({ preventScroll: true });
  }
  _close() {
    const c = this.cur; if (!c) return;
    c.closing = true;
    this.cur = null;
    c.block.setEditing(null);
    if (c.restoreTitle && c.block.titleLabel) c.block.titleLabel.visible = true;
    this.el.hidden = true; this.el.classList.remove('bad'); this.el.innerHTML = '';
    if (document.activeElement === document.body || this.el.contains(document.activeElement) || !document.activeElement) this.ws.renderer.domElement.focus?.({ preventScroll: true });
  }

  /* ---------- DOM ---------- */
  _build(c) {
    const f = c.field, F = f.font || {};
    this.el.innerHTML = '';
    this.el.dataset.kind = c.kind;
    const value = this.valueOf(c.block, f);
    const text = f.format ? f.format(value) : value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    if (c.kind === 'select') {
      const list = document.createElement('div'); list.className = 'fe-list'; list.tabIndex = -1; list.setAttribute('role', 'listbox');
      const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
      c.value = value; c.options = opts;
      opts.forEach((o) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'fe-option'; b.setAttribute('role', 'option'); b.textContent = o.label; b.dataset.value = String(o.value);
        b.classList.toggle('on', same(o.value, value)); b.setAttribute('aria-selected', String(same(o.value, value)));
        b.addEventListener('click', (e) => { e.stopPropagation(); c.value = o.value; this._commit(); });
        list.appendChild(b);
      });
      list.addEventListener('keydown', (e) => this._onKey(c, e));
      list.addEventListener('focusout', () => this._onBlur(c));
      c.list = list; c.input = null;
      this.el.appendChild(list);
    } else {
      const input = document.createElement(c.kind === 'text' || c.kind === 'multiline' ? 'textarea' : 'input');
      input.className = 'fe-input';
      if (c.kind === 'date') input.type = 'date';
      else if (c.kind === 'number') { input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; }
      else { input.rows = 1; input.wrap = 'soft'; input.spellcheck = false; }
      input.value = text;
      if (f.placeholder) input.placeholder = f.placeholder;
      input.setAttribute('aria-label', f.label || f.param || f.id);
      input.addEventListener('keydown', (e) => this._onKey(c, e));
      input.addEventListener('input', () => { this.el.classList.remove('bad'); c.err.hidden = true; this._grow(c); });
      input.addEventListener('blur', () => this._onBlur(c));
      if (c.kind === 'date') input.addEventListener('change', () => { if (this.cur === c && input.value) this._commit(); });
      c.input = input;
      this.el.appendChild(input);
    }
    const err = document.createElement('div'); err.className = 'fe-error'; err.hidden = true; c.err = err; this.el.appendChild(err);
    const hint = document.createElement('div'); hint.className = 'fe-hint';
    hint.textContent = c.kind === 'select' ? '↑ ↓ choose · Enter · Esc' : c.kind === 'multiline' ? 'Enter saves · Shift+Enter new line · Esc cancels' : c.kind === 'number' ? 'Enter saves · ↑ ↓ nudge · Esc cancels' : 'Enter saves · Esc cancels · Tab next';
    c.hint = hint; this.el.appendChild(hint);
    this._style(c);
  }
  /** Face colours and type for this field (theme tokens unless the field says otherwise). */
  _style(c) {
    const f = c.field, F = f.font || {};
    const s = this.el.style;
    s.setProperty('--fe-bg', f.bg || palette.faceBg);
    s.setProperty('--fe-color', F.color || palette.faceText);
    s.setProperty('--fe-dim', withAlpha(F.color || palette.faceText, 0.45));
    s.setProperty('--fe-accent', palette.faceAccent);
    s.setProperty('--fe-ring', withAlpha(palette.faceAccent, 0.7));
    s.fontFamily = F.mono ? typography.mono : typography.family;
    s.fontWeight = String(F.weight || 500);
    s.textAlign = F.align === 'center' ? 'center' : F.align === 'right' ? 'right' : 'left';
    s.lineHeight = String(F.lineHeight || 1.3);
  }
  _grow(c) {
    const i = c.input; if (!i || i.tagName !== 'TEXTAREA') return;
    i.style.height = '0px';
    i.style.height = `${Math.max(i.scrollHeight, c.minH || 0)}px`;
  }
  /** Place the editor over the projected region; the font follows the face at this zoom, clamped 11–28 px (the box grows with the clamp, centred on the region). */
  _place() {
    const c = this.cur; if (!c) return;
    const fresh = c.block.fields().find((f) => f.id === c.field.id);
    if (fresh) c.field = fresh;
    const R = this.screenRect(c.block, c.field);
    if (!R) { this.el.style.visibility = 'hidden'; return; }
    this.el.style.visibility = '';
    const want = this._fontPx(c.field) * R.scale;
    const px = Math.min(FONT_MAX, Math.max(FONT_MIN, want));
    const k = px / Math.max(1e-6, want);                 // > 1 when the clamp made the type bigger than the face's
    const pad = Math.round(px * PAD);
    let w = Math.max(Math.round(R.width * k) + 2 * pad, Math.round(px * 5));
    const minH = Math.round(R.height * k) + 2 * pad;
    const cx = (R.left + R.right) / 2, cy = (R.top + R.bottom) / 2;
    let x = Math.round(cx - w / 2), y = Math.round(cy - minH / 2);
    if (c.kind === 'select') { x = Math.round(R.left - pad); y = Math.round(R.bottom + 4); w = Math.max(w, 160); }
    const vp = R.vp, M = 6;
    if (w > vp.width - 2 * M) w = Math.round(vp.width - 2 * M);
    x = Math.min(Math.max(x, vp.left + M), vp.right - w - M);
    y = Math.min(Math.max(y, vp.top + M), vp.bottom - minH - M);
    const sig = `${x}|${y}|${w}|${minH}|${px.toFixed(2)}|${pad}`;
    if (sig === this._last) return;
    this._last = sig;
    const s = this.el.style;
    s.transform = `translate(${x}px, ${y}px)`; s.width = `${w}px`; s.fontSize = `${px.toFixed(2)}px`;
    s.setProperty('--fe-pad', `${pad}px`); s.setProperty('--fe-r', `${Math.max(4, Math.round(px * 0.35))}px`);
    c.minH = c.kind === 'select' ? 0 : minH;
    if (c.input) { c.input.style.minHeight = `${minH}px`; this._grow(c); }
  }

  /* ---------- keys, blur ---------- */
  _onKey(c, e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); return; }
    if (k === 'Tab') { e.preventDefault(); e.stopPropagation(); this.next(e.shiftKey ? -1 : 1); return; }
    if (c.kind === 'select') {
      const i = c.options.findIndex((o) => same(o.value, c.value));
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const n = c.options.length; if (!n) return; const j = (i + (k === 'ArrowDown' ? 1 : -1) + n) % n; c.value = c.options[j].value; c.list.querySelectorAll('.fe-option').forEach((b, m) => { b.classList.toggle('on', m === j); b.setAttribute('aria-selected', String(m === j)); }); return; }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); this._commit(); return; }
      return;
    }
    if (k === 'Enter') {
      if (c.kind === 'multiline' && e.shiftKey) return;   // a newline
      e.preventDefault(); e.stopPropagation(); this._commit(); return;
    }
    if (c.kind === 'number' && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      const f = c.field, step = (Number.isFinite(f.step) ? f.step : 1) * (e.shiftKey ? 10 : 1);
      const v0 = Number(String(c.input.value).replace(',', '.'));
      let v = (Number.isFinite(v0) ? v0 : Number(this.valueOf(c.block, f)) || 0) + (k === 'ArrowUp' ? step : -step);
      if (Number.isFinite(f.min)) v = Math.max(f.min, v); if (Number.isFinite(f.max)) v = Math.min(f.max, v);
      const d = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1));
      c.input.value = String(+v.toFixed(d));
      this.el.classList.remove('bad'); c.err.hidden = true;
    }
  }
  _onBlur(c) {
    if (c.closing) return;
    setTimeout(() => {
      if (this.cur !== c || c.closing) return;
      const a = document.activeElement;
      if (a && this.el.contains(a)) return;
      if (!this._commit()) this.cancel();   // an invalid value is not written on blur
    }, 0);
  }

  /* ---------- per frame ---------- */
  update() {
    if (this.cur) {
      if (!this.world.nodes.includes(this.cur.block)) { this.cancel(); return; }
      this._place();
    }
    if (this.hov) this._placeHover();
  }
}
