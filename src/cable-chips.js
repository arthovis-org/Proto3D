// cable-chips.js — value chips on cables. A small rounded chip at a cable's midpoint says what
// is flowing through it right now: a type glyph in the cable's colour (a dot for values, a
// chevron for events) plus a short formatted value — numbers formatted, text cut to ~24 chars,
// booleans as on / off, an event as "pulse" (the chip flashes when one passes), data as a summary
// ("{3 keys}", "[12 items]"), media as kind + name, project kinds by name ("person · Maya Chen").
// While the cable is hovered (or selected) a second, dimmer line names the endpoints
// ("Prompt.prompt → Generate Text.prompt").
//
// A bundle trunk (bundles.js) gets a chip of its own — "3 cables", the member paths on hover — while
// any of its members would show one; a bundled cable's own chip sits near its destination fan-out.
//
// Chips are canvas sprites in the Inter stack that face the camera. They show for the hovered
// cable, the selected cable and every cable of a selected block (the union for a multi-select),
// never at the far LOD, and at most `max` at once (nearest to the camera first). Every chip owns
// one fixed-size canvas (WebGL allocates a texture's storage once, at the size it first sees, so
// the canvas is never resized) painted only when its text, its hover line, the theme or a flash
// changes — the per-frame work is a signature comparison and a sprite move; the text is the same
// size on every chip, and a chip's on-screen text height is clamped to 12–22 CSS px (world-sized
// in between) so a far chip stays legible and a near one never dwarfs its block.
import * as THREE from 'three';
import { palette, typography, getTheme, hex, portColorFor } from './theme.js';
import { kindOf, formatNumber, isPulse } from './core/types.js';
import { roundRect, fitLine } from './faces.js';

export const CHIP_MAX = 40;
const FONT = 64, SUB = 42, PADX = 30, PADY = 14, GLYPH = 18, GAP = 18;
const CW = 960, CH = Math.ceil(FONT * 1.25 + SUB * 1.35 + 2 * PADY);   // one fixed canvas per chip: the GPU storage is allocated once and only repainted
const UNITS_PER_PX = 0.2 / FONT;      // one text line ≈ 0.2 world units tall — the same on every chip
const TEXT_PX = [12, 22];             // on screen the text line stays between these CSS px: a far chip grows, a very near one shrinks
const LIFT = 0.16;                    // the chip's bottom edge sits this far above the cable (scaled with the chip)
const FLASH = 0.35;                   // seconds an event chip stays lit after a pulse
const _mid = new THREE.Vector3();

const cut = (s, n = 24) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const nameOf = (v) => { const k = ['name', 'title', 'label', 'id'].find((x) => typeof v[x] === 'string' || typeof v[x] === 'number'); return k ? String(v[k]) : ''; };

/**
 * The short text a chip shows for `value` travelling on a port of `type` / `subtype`.
 * Exported for tests and the panel; returns '' for nothing.
 */
export function chipText(value, type = 'any', subtype = null) {
  if (value === undefined || value === null) return type === 'event' ? 'no pulse yet' : 'no value';
  if (isPulse(value)) {
    const p = value.payload;
    const extra = p === undefined || p === null ? '' : typeof p === 'object' ? (nameOf(p) ? ` · ${cut(nameOf(p), 18)}` : '') : ` · ${cut(p, 18)}`;
    return `pulse${extra}`;
  }
  switch (kindOf(value)) {
    case 'number': return formatNumber(value);
    case 'boolean': return value ? 'on' : 'off';
    case 'text': return value === '' ? 'empty text' : cut(value);
    case 'media': return cut(`${value.kind} · ${value.title || 'untitled'}`, 28);
    case 'media-list': return `${value.length} media`;
    case 'media-layout': return `grid ${value.cols}×${value.rows} · ${value.items.length}`;
    default: break;
  }
  // data: project kinds by name, otherwise a shape summary
  if (Array.isArray(value)) {
    const n = value.length;
    if (subtype === 'tasks' || (n && value.every((x) => x && typeof x === 'object' && 'title' in x && ('column' in x || 'due' in x)))) return `${n} task${n === 1 ? '' : 's'}`;
    return `[${n} item${n === 1 ? '' : 's'}]`;
  }
  if (typeof value === 'object') {
    const kind = subtype || (typeof value.doneRatio === 'number' ? 'stats' : value.date && ('reached' in value || 'daysLeft' in value) ? 'milestone' : value.role !== undefined && value.name ? 'person' : Array.isArray(value.columns) ? 'board' : null);
    switch (kind) {
      case 'person': return cut(`person · ${nameOf(value) || 'unnamed'}`, 28);
      case 'task': return cut(`task · ${nameOf(value) || 'untitled'}`, 28);
      case 'milestone': return cut(`milestone · ${nameOf(value) || value.date || ''}`, 28);
      case 'board': return `board · ${value.columns.length} column${value.columns.length === 1 ? '' : 's'}`;
      case 'stats': return `stats · ${value.done ?? 0}/${value.total ?? 0} done`;
      case 'layout': return `layout · ${(value.items || []).length} items`;
      default: { const n = Object.keys(value).length; return `{${n} key${n === 1 ? '' : 's'}}`; }
    }
  }
  return cut(String(value));
}
/** "Prompt.prompt → Generate Text.prompt" for a complete cable. */
export const chipPath = (c) => (c.from && c.to ? `${c.from.owner.title}.${c.from.label} → ${c.to.owner.title}.${c.to.label}` : '');

const rgba = (hexStr, a) => { const n = parseInt(String(hexStr).replace('#', ''), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

/**
 * Paint a chip into its fixed canvas, centred: a pill (one line) or a rounded card (two lines)
 * only as wide as its text, the glyph in the type colour, Inter type, theme tokens. Returns the
 * painted width and height in canvas px (the sprite is scaled to the whole canvas, so every chip's
 * text is the same size; the rest of the canvas stays transparent).
 */
function paint(canvas, { text, sub, color, event, flash }) {
  const g = canvas.getContext('2d');
  const maxText = CW - GLYPH * 2 - GAP - PADX * 2 - 6;
  g.font = `500 ${FONT}px ${typography.family}`;
  text = fitLine(g, text, maxText);
  const tw = Math.ceil(g.measureText(text).width);
  g.font = `500 ${SUB}px ${typography.family}`;
  sub = sub ? fitLine(g, sub, maxText) : '';
  const sw = sub ? Math.ceil(g.measureText(sub).width) : 0;
  const lineH = FONT * 1.25, subH = sub ? SUB * 1.35 : 0;
  const w = Math.max(tw, sw) + GLYPH * 2 + GAP + PADX * 2, h = lineH + subH + PADY * 2;
  const x0 = Math.round((CW - w) / 2), y0 = CH - h;   // bottom-aligned: the sprite's anchor is its bottom centre, just above the cable
  g.clearRect(0, 0, CW, CH);
  roundRect(g, x0 + 3, y0 + 3, w - 6, h - 6, sub ? 26 : h / 2);
  g.fillStyle = flash ? rgba(color, 0.92) : rgba(palette.faceBg, 0.94); g.fill();
  g.lineWidth = 3; g.strokeStyle = rgba(color, flash ? 1 : 0.7); g.stroke();
  // glyph: a dot for values, a chevron for events (the flow direction, like the pins)
  const gx = x0 + PADX + GLYPH, gy = y0 + PADY + lineH / 2;
  g.fillStyle = flash ? '#ffffff' : color;
  if (event) { g.beginPath(); g.moveTo(gx - GLYPH, gy - GLYPH * 0.8); g.lineTo(gx + GLYPH * 0.2, gy - GLYPH * 0.8); g.lineTo(gx + GLYPH, gy); g.lineTo(gx + GLYPH * 0.2, gy + GLYPH * 0.8); g.lineTo(gx - GLYPH, gy + GLYPH * 0.8); g.closePath(); g.fill(); }
  else { g.beginPath(); g.arc(gx, gy, GLYPH * 0.72, 0, Math.PI * 2); g.fill(); }
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const tx = x0 + PADX + GLYPH * 2 + GAP;
  g.font = `500 ${FONT}px ${typography.family}`; g.fillStyle = flash ? '#ffffff' : palette.faceText;
  g.fillText(text, tx, gy + FONT * 0.04);
  if (sub) { g.font = `500 ${SUB}px ${typography.family}`; g.fillStyle = flash ? 'rgba(255,255,255,0.8)' : palette.faceDim; g.fillText(sub, tx, y0 + PADY + lineH + subH / 2 + SUB * 0.04); }
  return { w, h };
}

export class CableChips {
  /** @param {THREE.Scene} scene */
  constructor(scene, { max = CHIP_MAX } = {}) {
    this.scene = scene;
    this.max = max;
    this.group = new THREE.Group(); this.group.name = 'cable-chips'; this.group.renderOrder = 6;
    scene.add(this.group);
    this.pool = [];               // every sprite ever made: { sprite, canvas, tex, conn, sig, alpha, flashUntil, seenPulse, text, sub, painted }
    this.byConn = new Map();      // connection → chip in use this frame
    this.count = 0;               // chips shown this frame
  }
  /** The chip currently shown for a connection, or null. */
  chipFor(c) { return this.byConn.get(c) || null; }
  _make() {
    const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;   // fixed size: never resized, only repainted
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
    sprite.center.set(0.5, 0); sprite.renderOrder = 6; sprite.visible = false;
    this.group.add(sprite);
    const chip = { sprite, canvas, tex, conn: null, sig: '', alpha: 0, flashUntil: -1, seenPulse: -1, text: '', sub: '', changedAt: NaN, w: CW * UNITS_PER_PX, h: CH * UNITS_PER_PX, painted: { w: 0, h: 0 } };
    this.pool.push(chip);
    return chip;
  }
  /** Which cables get a chip: hovered, selected, or touching a selected block (not dimmed while something is selected); never far, never hidden. */
  _wants(c, hovered, anySelected) {
    if (!c.visible || !c.complete || c.far) return false;
    if (c.kind === 'bundle') return c.hovered || c.members.some((m) => this._wants(m, hovered, anySelected));
    return c === hovered || c.hovered || c.selected || (anySelected && !c.dimSelect);
  }
  /** CSS pixels one world unit covers at distance `d` for this camera (perspective) or anywhere (orthographic). */
  _pxPerUnit(camera, renderer, d) {
    const H = renderer?.domElement?.clientHeight || 800;
    if (camera.isOrthographicCamera) return H * (camera.zoom || 1) / Math.max(1e-6, camera.top - camera.bottom);
    return H / (2 * Math.max(d, 1e-3) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  /**
   * Per frame. `hovered` is the cable under the pointer (or null), `anySelected` whether a block
   * or cable is selected, `time` the engine clock, `renderer` gives the viewport height for the
   * on-screen size clamp. Chips are recycled by connection so a value change repaints only that chip.
   */
  update(world, camera, { hovered = null, anySelected = false, time = 0, dt = 0.016, renderer = null } = {}) {
    const cam = camera.position;
    const cands = [];
    for (const c of world.connections) if (this._wants(c, hovered, anySelected)) { c.chipPoint(_mid); cands.push([c, cam.distanceToSquared(_mid)]); }
    for (const b of world.bundles || []) if (this._wants(b, hovered, anySelected)) { b.chipPoint(_mid); cands.push([b, cam.distanceToSquared(_mid)]); }
    cands.sort((a, b) => a[1] - b[1]);
    if (cands.length > this.max) cands.length = this.max;
    const live = new Set(cands.map((x) => x[0]));
    // release chips whose cable is gone or no longer wanted
    for (const [c, chip] of this.byConn) if (!live.has(c)) { this.byConn.delete(c); chip.conn = null; chip.alpha = 0; chip.sprite.visible = false; chip.sprite.material.opacity = 0; }
    const theme = getTheme();
    for (const [c] of cands) {
      let chip = this.byConn.get(c);
      const bundle = c.kind === 'bundle';
      if (!chip) { chip = this.pool.find((x) => !x.conn) || this._make(); chip.conn = c; chip.sig = ''; chip.alpha = 0; chip.flashUntil = -1; chip.seenPulse = bundle ? -1 : (c.from.lastPulseAt ?? -1); chip.changedAt = NaN; this.byConn.set(c, chip); }
      let sub, color, flash = false;
      if (bundle) {
        // the trunk: how many cables run in it; the member paths while it is hovered
        chip.text = `${c.members.length} cables`;
        sub = c.hovered ? c.members.slice(0, 3).map((m) => chipPath(m)).join(' · ') + (c.members.length > 3 ? ` · +${c.members.length - 3}` : '') : '';
        color = hex(palette.cableTrunk);
      } else {
        // text: recomputed only when the source port changed (or pulsed), not every frame
        const src = c.from, changedAt = Math.max(src.changedAt ?? -1, src.lastPulseAt ?? -1);
        if (changedAt !== chip.changedAt || chip.sig === '') { chip.changedAt = changedAt; chip.text = chipText(c.compat === 'coerce' ? c.value : src.value, c.type, c.subtype); }
        if (c.type === 'event' && (src.lastPulseAt ?? -1) > chip.seenPulse) { chip.seenPulse = src.lastPulseAt; chip.flashUntil = time + FLASH; }
        flash = chip.flashUntil > time;
        const detail = c === hovered || c.hovered || c.selected;
        sub = detail ? chipPath(c) : '';
        color = hex(c.valid ? (c.compat === 'coerce' && c.to ? portColorFor(c.to.type, c.to.subtype) : portColorFor(c.type, c.subtype)) : 0xff4d5e);
      }
      const detail = bundle ? c.hovered : (c === hovered || c.hovered || c.selected);
      const sig = `${chip.text}|${sub}|${color}|${flash ? 1 : 0}|${theme}`;
      if (sig !== chip.sig) {
        chip.sig = sig; chip.sub = sub;
        chip.painted = paint(chip.canvas, { text: chip.text, sub, color, event: !bundle && c.type === 'event', flash });
        chip.tex.needsUpdate = true;
      }
      // place: bottom-centre anchored a little above the chip point (the midpoint; near the far
      // fan-out of a bundled cable), a small bump while flashing; the text line is kept between
      // TEXT_PX on screen (world-sized in between, so chips shrink with distance but never below
      // legibility and never dwarf the block they sit beside)
      c.chipPoint(_mid);
      const textPx = 0.2 * this._pxPerUnit(camera, renderer, cam.distanceTo(_mid));
      const k = textPx < TEXT_PX[0] ? TEXT_PX[0] / textPx : textPx > TEXT_PX[1] ? TEXT_PX[1] / textPx : 1;
      _mid.y += LIFT * k;
      const bump = (flash ? 1 + 0.18 * ((chip.flashUntil - time) / FLASH) : 1) * k;
      chip.sprite.position.copy(_mid);
      chip.sprite.scale.set(chip.w * bump, chip.h * bump, 1);
      chip.k = k;
      chip.alpha = Math.min(1, chip.alpha + dt / 0.12);
      chip.sprite.material.opacity = chip.alpha * (detail ? 1 : 0.92);
      chip.sprite.visible = true;
    }
    this.count = cands.length;
  }
  dispose() { for (const ch of this.pool) { ch.tex.dispose(); ch.sprite.material.dispose(); } this.pool = []; this.byConn.clear(); this.scene.remove(this.group); }
}
