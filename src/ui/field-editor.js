// ui/field-editor.js — edit mode and the field editor: edit a face field where it is drawn.
//
// A face renderer registers editable regions (faces.js `beginFields`, or `body3d.fields(node)` for
// custom bodies). Nothing shows while the user simply works with a block — click selects, drag
// moves, face buttons and cards behave as always. **Edit mode** is entered per block (a
// double-click on the block, Enter with it selected, the pencil in the mini toolbar, Edit → Edit
// content): the block gets a frame in its category accent (`Block3D.setEditMode`), every editable
// region on its face is marked in the face canvas itself (`Block3D.renderFace` draws the markers,
// so they sit in perspective by construction), a hint pill under the block names the keys, and the
// pointer only edits: a click on a field opens its editor, a press elsewhere on the block does
// nothing (no drag — leave edit mode to move it, like Blender's object vs edit mode). Tab / Shift+Tab
// walk the fields, Enter opens the focused one, Esc closes the editor and, pressed again, leaves;
// so does a click on empty space or on another block, or the pencil. One block at a time.
//
// **The editor** (`#field-editor`) is an HTML element that sits *on the face plane*: it is sized in
// face px (the field's logical rect plus a padding) and typeset in face px, and a CSS `matrix3d`
// computed every frame from the field's four projected corners (a unit-square → quad homography)
// lays it onto the face, so the box, the text and the caret share the face's perspective in 3D and
// in the plan. Typing is legible by construction when the face is reasonably front-on; when the
// line of text would be under ~11 css px or the face is turned more than ~55° from the view, a
// short camera glide (350 ms, `ws.flyTo`) faces the field head-on at a comfortable distance and the
// pose is restored when edit mode ends, unless the camera was moved meanwhile (`glideSetting`,
// View → Glide to text when editing, persisted). Kinds: text and multiline are a textarea that
// grows with its content, number nudges with the arrow keys, select is a themed list under the
// field (flat, it is a menu), date a date input with the themed month picker under it (ui/date-picker.js); a checkbox toggles at once and an action runs its
// handler (the model chip opens the model browser). Enter commits (Shift+Enter is a newline in
// multiline), Esc cancels, blur commits. A commit goes through the param command (undoable, the
// panel follows) and the face redraws; while the editor is open the block leaves that text out
// (`instance._editing`) so nothing doubles up.
import * as THREE from 'three';
import * as cmd from '../core/commands.js';
import { palette, typography, sizes, onThemeChange } from '../theme.js';
import { attachScrub } from './scrub.js';
import { openDatePicker } from './date-picker.js';

const PAD = 0.35;                                  // editor padding as a fraction of the font size (face px), drawn outward from the field rect
const LABEL_PX = 92;                               // face px per unit of a 3D label's `size` (theme.js makeLabel: 96 px glyphs on a 1.3 line)
export const MIN_LINE_PX = 11;                     // css px: a line of text under this glides the camera closer
export const MAX_FACE_ANGLE = 55;                  // degrees between the face normal and the view: beyond this the camera glides head-on
export const GLIDE_S = 0.35;                       // the glide's length
export const FACE_FILL = 0.6;                      // the glide frames the block's face at this share of the viewport height
const GLIDE_KEY = 'proto3d.editGlide.v1';
const _c = [0, 1, 2, 3].map(() => new THREE.Vector3()), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _box = new THREE.Box3();
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

/* ---------- the glide setting (persisted; View → Glide to text when editing) ---------- */
let glideOn = true;
try { const s = localStorage.getItem(GLIDE_KEY); if (s === '0') glideOn = false; } catch (_) { /* private mode */ }
const glideListeners = new Set();
export const glideSetting = {
  get on() { return glideOn; },
  set(v) { v = !!v; if (v === glideOn) return; glideOn = v; try { localStorage.setItem(GLIDE_KEY, v ? '1' : '0'); } catch (_) { /* ignore */ } glideListeners.forEach((cb) => cb(glideOn)); },
  toggle() { glideSetting.set(!glideOn); return glideOn; },
  onChange(cb) { glideListeners.add(cb); return () => glideListeners.delete(cb); },
};

/**
 * The homography that maps the unit square (0,0) (1,0) (1,1) (0,1) onto the quad `q` (four [x, y]
 * points: top-left, top-right, bottom-right, bottom-left), as a row-major 3×3 [a b c d e f g h i]:
 * (u, v) → ((a u + b v + c) / (g u + h v + i), (d u + e v + f) / (g u + h v + i)). Null when degenerate.
 */
export function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-9) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
/**
 * The CSS `matrix3d(…)` that lays an element of `w × h` css px, whose inner box starts `pad` px
 * in from its top-left, onto `quad` (viewport px) with `transform-origin: 0 0`: the element's
 * (pad, pad) lands on the quad's first corner and (pad + w, pad + h) on its third.
 */
export function quadMatrix(quad, w, h, pad = 0) {
  const H = squareToQuad(quad);
  if (!H || w <= 0 || h <= 0) return null;
  const [a, b, c, d, e, f, g, k, i] = H;
  // compose with (x, y) → ((x − pad) / w, (y − pad) / h)
  const m = [a / w, b / h, c - (a * pad) / w - (b * pad) / h, d / w, e / h, f - (d * pad) / w - (e * pad) / h, g / w, k / h, i - (g * pad) / w - (k * pad) / h];
  const s = m[8] !== 0 ? 1 / m[8] : 1;
  const M = m.map((x) => x * s);
  // column-major 4×4 with z passed through: X = M0 x + M1 y + M2, Y = M3 x + M4 y + M5, W = M6 x + M7 y + M8
  const fmt = (x) => (Math.abs(x) < 1e-9 ? '0' : x.toPrecision(9));
  return { css: `matrix3d(${[M[0], M[3], 0, M[6], M[1], M[4], 0, M[7], 0, 0, 1, 0, M[2], M[5], 0, M[8]].map(fmt).join(', ')})`, m: M };
}
/** Apply a row-major 3×3 homography to a point. */
export function applyH(m, x, y) { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; }

export class FieldEditor {
  /** @param {object} o { ws, world, history, selection, interaction?, overlays?, els: { editor, hint } } */
  constructor({ ws, world, history, selection, interaction = null, overlays = null, els }) {
    Object.assign(this, { ws, world, history, selection, interaction, overlays });
    this.el = els.editor; this.hintEl = els.hint || null;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'Edit field');
    if (this.hintEl) { this.hintEl.setAttribute('role', 'status'); this.hintEl.hidden = true; }
    this.cur = null;      // the open editor: { block, field, kind, input, list?, err, closing, restoreTitle, pad, w, h }
    this.mode = null;     // edit mode: { block, focus: field id | null, glide: { saved: { position, target }, touched, off } | null }
    this._last = '';      // last applied placement (skip identical style writes)
    this._lastHint = '';
    this._listeners = new Set();
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this._offTheme = onThemeChange(() => { if (this.cur) this._style(this.cur); });
    // the selection moved elsewhere (panel, palette, marquee): edit mode follows it out
    selection.onChange(() => { if (this.mode && !selection.has(this.mode.block)) this.leaveEdit(); });
  }

  /* ---------- state ---------- */
  /** The field editor is open. */
  get active() { return !!this.cur; }
  /** The block and field being edited (tests, the mini toolbar). */
  get editing() { return this.cur ? { block: this.cur.block, field: this.cur.field } : null; }
  /** The block in edit mode, or null. */
  get editBlock() { return this.mode ? this.mode.block : null; }
  /** Edit mode changed (entered, left or switched block): cb(block | null). */
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _notify() { this._listeners.forEach((cb) => cb(this.editBlock)); }
  /** Whether a block has anything to edit in place. */
  editable(block) { return !!(block && block.fields && block.fields().length); }
  /** The current value of a field on a block. */
  valueOf(block, f) {
    if (f.get) return f.get(block);
    if (f.prop === 'title') return block.title;
    if (f.param) return block.params[f.param];
    return undefined;
  }
  /** Fields the keyboard walks with Tab (no checkboxes or actions). */
  tabbable(block) { return block.fields().filter((f) => f.kind !== 'checkbox' && f.kind !== 'action'); }

  /* ---------- edit mode ---------- */
  /**
   * Enter edit mode on `block` (switching from another block commits what was typed there). With
   * `field`, that field's editor opens at once (a double-click on text); otherwise the first field
   * is focused and Enter opens it. Returns true when the block is in edit mode.
   */
  enterEdit(block, { field = null } = {}) {
    if (!block || !this.world.nodes.includes(block)) return false;
    if (this.mode && this.mode.block !== block) this.leaveEdit();
    if (!this.mode) {
      if (!this.selection.has(block) || this.selection.size !== 1) this.selection.set([block]);
      this.mode = { block, focus: null, glide: null };
      block.setEditMode?.(true);
      this._lastHint = '';
      this._notify();
    }
    if (field) this.open(block, field);
    else if (!this.cur) { const f = this.tabbable(block)[0]; this.mode.focus = f ? f.id : null; }
    return true;
  }
  /** Leave edit mode: commit the open editor (an invalid value is dropped), clear the frame and markers, restore the camera the glide moved. */
  leaveEdit() {
    const m = this.mode; if (!m) return;
    if (this.cur && !this._commit()) this.cancel();
    this.mode = null;
    m.block.setEditMode?.(false);
    if (this.hintEl) this.hintEl.hidden = true;
    this._restoreGlide(m);
    this._notify();
  }
  /** The pencil: enter on `block`, or leave when it is the one in edit mode. */
  toggleEdit(block) { if (this.mode && (!block || this.mode.block === block)) { this.leaveEdit(); return false; } return this.enterEdit(block); }
  /** Tab / Shift+Tab while no editor is open: open the next (dir 1) or previous (−1) field after the focused one. */
  step(dir = 1) {
    const m = this.mode; if (!m) return false;
    if (this.cur) return this.next(dir);
    const list = this.tabbable(m.block); if (!list.length) return false;
    const i = list.findIndex((f) => f.id === m.focus);
    const target = i < 0 ? (dir > 0 ? list[0] : list[list.length - 1]) : list[(i + dir + list.length) % list.length];
    return this.open(m.block, target);
  }
  /** Enter while no editor is open: open the focused field (the first one when none was). */
  openFocused() {
    const m = this.mode; if (!m || this.cur) return false;
    const list = this.tabbable(m.block);
    const f = list.find((x) => x.id === m.focus) || list[0];
    return f ? this.open(m.block, f) : false;
  }

  /* ---------- geometry ---------- */
  /**
   * The field's four projected corners (viewport px: top-left, top-right, bottom-right,
   * bottom-left) plus the logical size (`w × h` face px), the css px per face px along the left
   * and right edges (`scaleL`, `scaleR`) and the angle (degrees) between the face normal and the
   * view direction; null when a corner is behind the camera.
   */
  screenQuad(block, f, camera = this.ws.camera) {
    const corners = block.fieldCorners(f, _c);
    if (!corners) return null;
    const r = this.ws.renderer.domElement.getBoundingClientRect();
    const pts = [];
    for (const c of corners) {
      _v.copy(c).project(camera);
      if (_v.z > 1 || !Number.isFinite(_v.x) || !Number.isFinite(_v.y)) return null;
      pts.push([r.left + (_v.x + 1) / 2 * r.width, r.top + (1 - _v.y) / 2 * r.height]);
    }
    const w = f.rect ? f.rect.w : f.local.w * sizes.face.pxPerUnit, h = f.rect ? f.rect.h : f.local.h * sizes.face.pxPerUnit;
    const edgeL = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]), edgeR = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
    // the face normal (corners run clockwise seen from the front) against the view direction
    _e1.subVectors(corners[1], corners[0]); _e2.subVectors(corners[3], corners[0]); _n.crossVectors(_e2, _e1).normalize();
    if (camera.isOrthographicCamera) camera.getWorldDirection(_v).negate(); else _v.copy(camera.position).sub(corners[0]).sub(_e1.multiplyScalar(0.5)).sub(_e2.multiplyScalar(0.5)).normalize();
    const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_n.dot(_v), -1, 1)));
    return { pts, w, h, scaleL: edgeL / Math.max(1e-6, h), scaleR: edgeR / Math.max(1e-6, h), angle, vp: r };
  }
  /** Face px of the field's type (a body field may give its label `size` in units through `font.labelSize`). */
  _fontPx(f) { const F = f.font || {}; return F.size || (F.labelSize ? F.labelSize * LABEL_PX : typography.scale.label); }

  /* ---------- open / close ---------- */
  /**
   * Open the editor on `field` of `block` (entering edit mode on the block when it is not in it).
   * Checkboxes toggle at once, actions run, everything else gets the projected editor with the
   * current value selected. Returns true when something happened.
   */
  open(block, field) {
    if (!block || !field) return false;
    if (!this.mode || this.mode.block !== block) { if (!this.enterEdit(block)) return false; }
    const kind = KINDS.has(field.kind) ? field.kind : 'text';
    if (this.cur) { if (this.cur.block === block && this.cur.field.id === field.id) return true; let ok = false; try { ok = this._commit(); } catch (_) { ok = false; } if (!ok) this.cancel(); }
    this.mode.focus = field.id;
    const api = this._api(block);
    if (kind === 'checkbox') { this._write(block, field, !this.valueOf(block, field)); return true; }
    if (kind === 'action') { field.run?.(block, api); return true; }
    const cur = { block, field, kind, closing: false, restoreTitle: false, pad: 0, w: 0, h: 0 };
    block.setEditing(field.id);
    if (field.prop === 'title' && block.titleLabel) { block.titleLabel.visible = false; cur.restoreTitle = true; }
    this._build(cur);
    this.cur = cur;
    this.el.hidden = false; this.el.classList.remove('bad');
    this._last = '';
    this._maybeGlide(block, field);
    this._place();
    if (kind === 'select') cur.list.focus({ preventScroll: true });
    else {
      cur.input.focus({ preventScroll: true });
      const v = cur.input.value || '';
      if (kind === 'multiline' || v.length > 40 || v.includes('\n')) { try { cur.input.setSelectionRange(v.length, v.length); } catch (_) { /* date inputs */ } }   // prose: the caret at the end, ready to continue
      else if (kind !== 'date') cur.input.select();                                                                                                            // a short value: retype it
      if (kind === 'date') requestAnimationFrame(() => { if (this.cur === cur) openDatePicker(cur.input); });   // the themed month grid opens with it (ui/date-picker.js); typing still works
    }
    return true;
  }
  /** Commit what is typed and close (false when the value is invalid: the editor stays open). */
  commit() { return this._commit(); }
  /** Close without writing (edit mode stays). */
  cancel() { if (this.cur) this._close(); }
  /** Commit and open the next (dir 1) or previous (−1) field on the same block. */
  next(dir = 1) {
    const c = this.cur; if (!c) return false;
    if (!this._commit()) return false;
    // a face may leave fields out while one of them is edited (the Prompt hides its chips under the open template): redraw first so the walk sees them all
    if (c.block.faceDirty && c.block.renderFace) { try { c.block.renderFace(); } catch (_) { /* the walk still works on what is registered */ } }
    const list = this.tabbable(c.block);
    const i = list.findIndex((f) => f.id === c.field.id);
    const n = list.length;
    const target = n ? list[((i < 0 ? 0 : i) + dir + n) % n] : null;
    if (!target || target.id === c.field.id) return true;
    return this.open(c.block, target);
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
    this.el.hidden = true; this.el.classList.remove('bad'); this.el.innerHTML = ''; this.el.style.transform = '';
    this._lastHint = '';
    if (document.activeElement === document.body || this.el.contains(document.activeElement) || !document.activeElement) this.ws.renderer.domElement.focus?.({ preventScroll: true });
  }

  /* ---------- the glide: face the field when it is too small or too oblique to read ---------- */
  /** Opening on a field that reads badly from here: fly to a head-on pose (once per edit-mode session; the pose comes back on leaving). */
  _maybeGlide(block, f) {
    const m = this.mode; if (!m || !glideSetting.on || m.glide) return false;
    const Q = this.screenQuad(block, f);
    if (!Q) return false;
    const line = this._fontPx(f) * Math.min(Q.scaleL, Q.scaleR);
    if (line >= MIN_LINE_PX && Q.angle <= MAX_FACE_ANGLE) return false;
    const pose = this.facingPose(block, f);
    if (!pose) return false;
    const C = this.ws.controls;
    const g = { saved: { position: C.camera.position.clone(), target: C.target.clone() }, pose, touched: false, off: null };
    // a hand on the camera after the glide (drag, wheel, a keyboard view: the Navigator's 'start') means the pose is theirs now: no restore
    const onStart = () => { g.touched = true; };
    C.addEventListener('start', onStart); g.off = () => C.removeEventListener('start', onStart);
    m.glide = g;
    this.ws.flyTo(pose.position, pose.target, GLIDE_S);
    return true;
  }
  /**
   * A camera pose looking straight at the block's face: out along the face normal (from the
   * field's corners), aimed at the face's centre, at the distance where the whole face spans
   * `FACE_FILL` (60 %) of the viewport height (or 75 % of its width, whichever is farther). Only
   * when the field's line of text would still be under `MIN_LINE_PX` there does it move in and
   * aim at the field — never closer than the face filling the viewport. Kept inside the controls'
   * range; a flat face (the plan) is seen from straight above with the plan's tiny tilt.
   * Returns { position, target, distance, faceFill, linePx }.
   */
  facingPose(block, f) {
    const corners = block.fieldCorners(f, _c);
    if (!corners) return null;
    const fieldCentre = new THREE.Vector3().add(corners[0]).add(corners[1]).add(corners[2]).add(corners[3]).multiplyScalar(0.25);
    _e1.subVectors(corners[1], corners[0]); _e2.subVectors(corners[3], corners[0]);
    const n = new THREE.Vector3().crossVectors(_e2, _e1).normalize();
    if (n.lengthSq() < 0.5) return null;
    // the face: the block's body centre moved onto the field's plane, its width and height along the plane
    const box = block.getAABB ? block.getAABB(_box) : null;
    const centre = box ? box.getCenter(new THREE.Vector3()) : fieldCentre.clone();
    centre.addScaledVector(n, -_v.subVectors(centre, fieldCentre).dot(n));
    const s = block.scale?.x || 1;
    const faceW = (block.width || 1) * s, faceH = (block.height || 1) * s;
    const C = this.ws.controls, cam = C.perspective || C.camera;
    const r = this.ws.renderer.domElement.getBoundingClientRect();
    const W = Math.max(1, r.width), H = Math.max(1, r.height), tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov || 50) / 2), aspect = W / H;
    const fontWorld = this._fontPx(f) / sizes.face.pxPerUnit;
    const dNode = Math.max(faceH / (2 * tanH * FACE_FILL), faceW / (2 * tanH * aspect * 0.75));   // the face at 60 % of the height (75 % of the width)
    const dFull = Math.max(faceH / (2 * tanH), faceW / (2 * tanH * aspect));                     // the face filling the viewport: never closer
    const linePxAt = (d) => fontWorld * H / (2 * d * tanH);
    let d = dNode, target = centre;
    if (linePxAt(dNode) < MIN_LINE_PX) { d = Math.max(dFull, fontWorld * H / (2 * tanH * MIN_LINE_PX)); target = fieldCentre; }   // small type on a big face: move in on the field
    // another block standing between the camera and the face: stop short of it (its box, along the line of sight)
    const ray = new THREE.Ray(target, n), hit = new THREE.Vector3();
    for (const o of this.world.nodes) {
      if (o === block || o.visible === false || !o.getAABB) continue;
      if (!ray.intersectBox(o.getAABB(_box), hit)) continue;
      const t = hit.distanceTo(target);
      if (t > 0.5 && t < d) d = Math.max(1.5, t - 0.6);
    }
    d = THREE.MathUtils.clamp(d, Math.max(1.5, C.minDistance || 0), C.maxDistance || 1e9);
    if (Math.abs(n.y) > 0.98) { const sg = Math.sign(n.y) || 1; n.set(0, sg * Math.cos(0.004), Math.sin(0.004)).normalize(); }   // a flat face: straight above, the plan's own tilt keeps `up` stable
    const position = target.clone().addScaledVector(n, d);
    if (position.y < 0.3) position.y = 0.3;
    return { position, target: target.clone(), distance: d, faceFill: faceH / (2 * d * tanH), linePx: linePxAt(d) };
  }
  /** Back to where the camera was before the glide, unless a hand moved it since. */
  _restoreGlide(m) {
    const g = m?.glide; if (!g) return;
    g.off?.();
    if (g.touched) return;
    this.ws.flyTo(g.saved.position, g.saved.target, GLIDE_S);
  }

  /* ---------- DOM ---------- */
  _build(c) {
    const f = c.field;
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
      else if (c.kind === 'number') {
        input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off';
        // Horizontal drag scrubs the value like the panel's number rows; it only edits the text, the commit path (Enter / blur) writes it.
        attachScrub(input, { step: () => (Number.isFinite(f.step) ? f.step : 1), min: f.min, max: f.max, keepFocus: true,
          get: () => { const v = Number(String(input.value).replace(',', '.')); return Number.isFinite(v) ? v : Number(this.valueOf(c.block, f)) || 0; },
          set: () => { this.el.classList.remove('bad'); c.err.hidden = true; } });
      }
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
  /**
   * Lay the editor on the face: the element is `w + 2 pad × h + 2 pad` face px in the face's type
   * size, and a matrix3d maps its inner box onto the field's projected quad. A select's list is a
   * flat menu under the field's bottom-left corner instead.
   */
  _place() {
    const c = this.cur; if (!c) return;
    const fresh = c.block.fields().find((f) => f.id === c.field.id);
    if (fresh) c.field = fresh;
    const Q = this.screenQuad(c.block, c.field);
    if (!Q) { this.el.style.visibility = 'hidden'; return; }
    const px = this._fontPx(c.field);
    const pad = Math.round(px * PAD);
    const w = Math.max(Math.round(Q.w), Math.round(px * 3)), h = Math.round(Q.h);
    c.pad = pad; c.w = w; c.h = h;
    const s = this.el.style;
    if (c.kind === 'select') {
      const vp = Q.vp, M = 6, [x0, y0] = Q.pts[3];
      const lw = Math.max(160, this.el.offsetWidth || 0), lh = this.el.offsetHeight || 0;
      const x = Math.min(Math.max(Math.round(x0), vp.left + M), vp.right - lw - M), y = Math.min(Math.max(Math.round(y0 + 4), vp.top + M), vp.bottom - lh - M);
      const sig = `list|${x}|${y}`;
      if (sig === this._last) return;
      this._last = sig; s.visibility = ''; s.transform = `translate(${x}px, ${y}px)`; s.width = ''; s.fontSize = '';
      return;
    }
    const T = quadMatrix(Q.pts, w, h, pad);
    if (!T) { s.visibility = 'hidden'; return; }
    s.visibility = '';
    const sig = `${T.css}|${w}|${h}|${px}|${pad}`;
    if (sig === this._last) return;
    this._last = sig;
    s.transform = T.css; s.width = `${w + 2 * pad}px`; s.fontSize = `${px}px`;
    s.setProperty('--fe-pad', `${pad}px`); s.setProperty('--fe-r', `${Math.max(4, Math.round(px * 0.35))}px`);
    c.minH = h + 2 * pad;
    if (c.input) { c.input.style.minHeight = `${c.minH}px`; this._grow(c); }
  }
  /** The hint pill under the block in edit mode. */
  _placeHint() {
    const el = this.hintEl, m = this.mode;
    if (!el) return;
    if (!m || document.body.classList.contains('placing')) { el.hidden = true; return; }
    const text = this.cur ? 'Enter saves · Tab next field · Esc done' : 'Enter or click a field to edit · Tab next field · Esc done';
    if (text !== this._lastHint) { this._lastHint = text; el.textContent = text; }
    const box = m.block.getAABB ? m.block.getAABB(_box) : null;
    if (!box) { el.hidden = true; return; }
    const r = this.ws.renderer.domElement.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < 8; k++) {
      _v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(this.ws.camera);
      if (_v.z > 1) { el.hidden = true; return; }
      const x = r.left + (_v.x + 1) / 2 * r.width, y = r.top + (1 - _v.y) / 2 * r.height;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (maxX < r.left || minX > r.right || maxY < r.top) { el.hidden = true; return; }
    el.hidden = false;
    const w = el.offsetWidth || 200, hgt = el.offsetHeight || 22, M = 8;
    const x = Math.min(Math.max((minX + maxX) / 2 - w / 2, r.left + M), r.right - w - M);
    const y = Math.min(Math.max(maxY + 10, r.top + M), r.bottom - hgt - M);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
    if (this.mode && !this.world.nodes.includes(this.mode.block)) { this.cancel(); this.leaveEdit(); return; }
    if (this.cur) this._place();
    this._placeHint();
  }
}
