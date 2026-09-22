// Settings — one place for the numbers every generator shares: size (a preset or a custom
// width × height), steps, guidance (cfg), strength (denoise for image-to-image), seed with an
// after-run rule (fixed · increment · decrement · random, ComfyUI's control_after_generate),
// count, and a Style section (a LoRA URL + scale, a style prefix appended to every prompt). The
// `settings` output plugs into any Generate node's `settings` input; `applySettings` (common.js)
// maps it onto the keys the chosen model's schema knows, and after each finished job the seed
// advances here. The face is a compact settings sheet whose numbers edit in place.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, drawCaps, drawDivider, drawChip, font, fitLine, tabular, PAD, beginFields } from '../../faces.js';
import { SIZE_PRESETS } from './common.js';

const PRESETS = [...Object.keys(SIZE_PRESETS), 'custom'];
const SEED_MODES = ['fixed', 'increment', 'decrement', 'random'];
const blankSeed = (v) => v === '' || v === null || v === undefined;

/** The settings object a Generate node receives. */
export function settingsOf(params) {
  const preset = PRESETS.includes(params.preset) ? params.preset : 'square';
  const P = SIZE_PRESETS[preset];
  const size = P ? { w: P[0], h: P[1], preset } : { w: Math.max(64, Math.round(+params.width) || 1024), h: Math.max(64, Math.round(+params.height) || 1024), preset: 'custom' };
  const lora = String(params.loraUrl || '').trim() ? { url: String(params.loraUrl).trim(), scale: Number.isFinite(+params.loraScale) ? +params.loraScale : 1 } : null;
  return {
    size, steps: Math.max(1, Math.round(+params.steps) || 20), guidance: Number.isFinite(+params.guidance) ? +params.guidance : 3.5,
    strength: Math.max(0, Math.min(1, Number.isFinite(+params.strength) ? +params.strength : 0.75)),
    seed: blankSeed(params.seed) ? null : Math.max(0, Math.round(+params.seed) || 0), seedMode: SEED_MODES.includes(params.seedMode) ? params.seedMode : 'fixed',
    count: Math.max(1, Math.min(4, Math.round(+params.count) || 1)), lora, stylePrefix: String(params.stylePrefix || '').trim(),
  };
}

export default registry.register({
  id: 'generate-settings', category: 'generate', label: 'Settings', icon: icons['generate-settings'], size: 'M',
  description: 'Size, steps, guidance, strength, seed (with an after-run rule), count and style for every Generate node it feeds',
  inputs: [],
  outputs: [{ key: 'settings', label: 'settings', type: 'data', subtype: 'settings' }],
  params: [
    { key: 'preset', label: 'size', type: 'select', options: PRESETS, default: 'square', hidden: true },
    { key: 'width', label: 'width', type: 'number', default: 1024, min: 64, max: 4096, step: 8, hidden: true },
    { key: 'height', label: 'height', type: 'number', default: 1024, min: 64, max: 4096, step: 8, hidden: true },
    { key: 'steps', label: 'steps', type: 'number', default: 20, min: 1, max: 150, step: 1, hidden: true },
    { key: 'guidance', label: 'guidance (cfg)', type: 'number', default: 3.5, min: 0, max: 30, step: 0.5, hidden: true },
    { key: 'strength', label: 'strength (denoise)', type: 'number', default: 0.75, min: 0, max: 1, step: 0.05, hidden: true },
    { key: 'seed', label: 'seed (blank = random)', type: 'text', default: '', hidden: true },
    { key: 'seedMode', label: 'after run', type: 'select', options: SEED_MODES, default: 'fixed', hidden: true },
    { key: 'count', label: 'count', type: 'number', default: 1, min: 1, max: 4, step: 1, hidden: true },
    { key: 'loraUrl', label: 'LoRA URL', type: 'text', default: '', hidden: true },
    { key: 'loraScale', label: 'LoRA scale', type: 'number', default: 1, min: 0, max: 2, step: 0.05, hidden: true },
    { key: 'stylePrefix', label: 'style preset (appended to prompts)', type: 'text', default: '', hidden: true },
  ],
  describeLink(from, toDef, to, n) { return to.key === 'settings' ? `${n.fromPoss} settings drive ${n.to}` : `${n.fromPoss} settings go to ${n.to}`; },
  evaluate({ params }) { return { settings: settingsOf(params) }; },
  footer: ({ params }) => { const S = settingsOf(params); return `${S.size.w}×${S.size.h} · ${S.steps} steps · cfg ${S.guidance} · seed ${S.seed === null ? 'random' : S.seed}${S.seedMode !== 'fixed' ? ` (${S.seedMode})` : ''}`; },
  face: {
    portAnchors: ({ h }) => ({ settings: h / 2 }),
    render(g, w, h, { params, instance }) {
      clear(g, w, h);
      const S = settingsOf(params);
      const F = beginFields(instance);
      const hits = []; instance._hits = hits;
      const dim = palette.faceDim, text = palette.faceText;
      drawCaps(g, 'settings', PAD, PAD + 8, { size: 11 });
      g.font = font(12, 500); g.fillStyle = dim; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(fitLine(g, S.lora ? `LoRA ×${S.lora.scale}${S.stylePrefix ? ' · style' : ''}` : S.stylePrefix ? `style: ${S.stylePrefix}` : 'no style', w * 0.5), w - PAD, PAD + 8);
      drawDivider(g, PAD, PAD + 24, w - 2 * PAD);
      // two columns of label / value rows; the values edit in place
      const colW = (w - 2 * PAD - 24) / 2, rowH = 40, y0 = PAD + 40;
      const rows = [
        [0, 0, 'size', `${S.size.preset === 'custom' ? 'custom' : S.size.preset} · ${S.size.w}×${S.size.h}`, null],
        [0, 1, 'steps', String(S.steps), { id: 'steps', param: 'steps', min: 1, max: 150, step: 1 }],
        [0, 2, 'guidance', String(S.guidance), { id: 'guidance', param: 'guidance', min: 0, max: 30, step: 0.5 }],
        [1, 0, 'strength', S.strength.toFixed(2), { id: 'strength', param: 'strength', min: 0, max: 1, step: 0.05 }],
        [1, 1, 'seed', S.seed === null ? 'random' : String(S.seed), { id: 'seed', param: 'seed', text: true }],
        [1, 2, 'count', String(S.count), { id: 'count', param: 'count', min: 1, max: 4, step: 1 }],
      ];
      for (const [col, row, label, value, field] of rows) {
        const x = PAD + col * (colW + 24), y = y0 + row * rowH;
        drawCaps(g, label, x, y + rowH / 2, { size: 10 });
        const vw = 96, vx = x + colW - vw;
        let editing = false;
        if (field) {
          const spec = field.text
            ? { id: field.id, kind: 'text', param: field.param, label, rect: { x: vx, y: y + 6, w: vw, h: rowH - 12 }, placeholder: 'random', validate: (v) => (v === '' || /^\d+$/.test(String(v).trim()) ? null : 'digits only, or blank for random'), parse: (v) => String(v).trim(), font: { size: 15, weight: 600, align: 'right', mono: true } }
            : { id: field.id, kind: 'number', param: field.param, label, rect: { x: vx, y: y + 6, w: vw, h: rowH - 12 }, min: field.min, max: field.max, step: field.step, font: { size: 15, weight: 600, align: 'right', mono: true } };
          editing = F.add(spec).editing;
        }
        if (!editing) { g.font = font(15, 600, true); tabular(g); g.fillStyle = field ? text : dim; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(fitLine(g, value, vw), vx + vw, y + rowH / 2 + 1); }
        if (label === 'seed') {
          // dice chip: the seed is random (blank), or a rule moves it after every run
          const chipLabel = S.seed === null ? '⚄ random' : S.seedMode !== 'fixed' ? `⚄ ${S.seedMode}` : null;
          if (chipLabel) { const cw = drawChip(g, chipLabel, x + 44, y + 9, { h: 22, bg: palette.faceCard, color: palette.faceAccent, size: 11, weight: 700, padX: 8 }); hits.push({ x: x + 44, y: y + 9, w: cw, h: 22, action: 'seedMode' }); }
        }
        if (row < 2) drawDivider(g, x, y + rowH, colW);
      }
    },
    /** A click on the dice chip cycles the after-run rule (fixed → increment → decrement → random). */
    onPointer({ instance }, ev) {
      if (ev.type !== 'click') return false;
      const px = ev.u * instance.face.cw, py = ev.v * instance.face.ch;
      const hit = (instance._hits || []).find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
      if (!hit) return false;
      const i = SEED_MODES.indexOf(instance.params.seedMode || 'fixed');
      instance.params.seedMode = SEED_MODES[(i + 1) % SEED_MODES.length]; instance.faceDirty = true; instance.world?.changed?.('param');
      return true;
    },
  },
  panel(api, b) {
    const s = api.section('Settings');
    api.select(s, 'size', PRESETS, () => b.params.preset, (v) => { api.setParam('preset', v); api.rebuild(); }, 'preset');
    if (b.params.preset === 'custom') {
      api.num(s, 'width', () => b.params.width, (v) => api.setParam('width', Math.max(64, Math.round(v)), 'width'), { step: 8, min: 64, max: 4096, attr: 'width' });
      api.num(s, 'height', () => b.params.height, (v) => api.setParam('height', Math.max(64, Math.round(v)), 'height'), { step: 8, min: 64, max: 4096, attr: 'height' });
    }
    api.num(s, 'steps', () => b.params.steps, (v) => api.setParam('steps', Math.max(1, Math.round(v)), 'steps'), { step: 1, min: 1, max: 150, attr: 'steps' });
    api.num(s, 'guidance (cfg)', () => b.params.guidance, (v) => api.setParam('guidance', Math.max(0, v), 'guidance'), { step: 0.5, min: 0, max: 30, attr: 'guidance' });
    api.num(s, 'strength (denoise)', () => b.params.strength, (v) => api.setParam('strength', Math.max(0, Math.min(1, v)), 'strength'), { step: 0.05, min: 0, max: 1, attr: 'strength' });
    api.text(s, 'seed (blank = random)', () => String(b.params.seed ?? ''), (v) => api.setParam('seed', v.replace(/[^\d]/g, ''), 'seed'), 'seed');
    api.select(s, 'after run', SEED_MODES, () => b.params.seedMode || 'fixed', (v) => api.setParam('seedMode', v), 'seedMode');
    s.appendChild(api.h('div', 'panel-note', 'After every finished run on a node this Settings feeds, the seed moves on by this rule (like ComfyUI\'s control after generate). That write is automatic and not an undo step.'));
    api.num(s, 'count', () => b.params.count, (v) => api.setParam('count', Math.max(1, Math.min(4, Math.round(v))), 'count'), { step: 1, min: 1, max: 4, attr: 'count' });
    s.appendChild(api.h('div', 'panel-note', 'Only the fields the chosen model knows are sent (size as its image_size / aspect option, steps, guidance, strength, seed, count); the Demo painter honours size, seed and count.'));
    const st = api.section('Style', false);
    api.text(st, 'LoRA URL', () => b.params.loraUrl || '', (v) => api.setParam('loraUrl', v, 'loraUrl'), 'loraUrl');
    api.num(st, 'LoRA scale', () => b.params.loraScale ?? 1, (v) => api.setParam('loraScale', Math.max(0, Math.min(2, v)), 'loraScale'), { step: 0.05, min: 0, max: 2, attr: 'loraScale' });
    api.area(st, 'style preset (appended to prompts)', () => b.params.stylePrefix || '', (v) => api.setParam('stylePrefix', v, 'stylePrefix'), 'stylePrefix', 2);
    st.appendChild(api.h('div', 'panel-note', 'The LoRA goes to fal models that take one (FLUX dev, FLUX general); the style text is appended to every prompt that runs with these settings.'));
  },
});
