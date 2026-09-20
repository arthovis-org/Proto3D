// Prompt — a prompt editor with variables. Write a template with `{Variable}` placeholders; every
// component plugged into the `variables` slot becomes a variable named after that component's
// title (`{Card title}`, `{Milestone}`), `{text}` is the explicit text input, `{1}` / `{2}` pick
// connections by position, and `{Name.path}` reaches into an object. The face typesets the
// template with the resolved values as chips (missing ones in amber); the output is the resolved
// prompt, ready for a Generate component.
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette } from '../../theme.js';
import { clear, drawDivider, drawCaps, font, roundRect, fitLine, PAD } from '../../faces.js';
import { asText, pick } from '../util.js';
import { escapeHTML } from './common.js';

const VAR_RE = /\{([^{}]+)\}/g;
const norm = (s) => String(s || '').trim().toLowerCase();

/** Resolve every `{…}` in the template: `[{ raw, name, value, found }]` in order, plus the text. */
export function resolvePrompt(template, { vars = [], text }) {
  const tokens = [];
  let out = '';
  let last = 0;
  const src = String(template || '');
  for (const m of src.matchAll(VAR_RE)) {
    out += src.slice(last, m.index);
    const raw = m[1].trim();
    const [head, ...rest] = raw.split('.');
    const path = rest.join('.');
    let found = false, value;
    if (norm(head) === 'text') { found = text !== undefined; value = text; }
    else if (/^\d+$/.test(head)) { const v = vars[+head - 1]; found = !!v && v.value !== undefined; value = v?.value; }
    else { const v = vars.find((x) => norm(x.name) === norm(head)) || vars.find((x) => norm(x.port) === norm(head)); found = !!v && v.value !== undefined; value = v?.value; }
    if (found && path) { value = pick(value, path); found = value !== undefined; }
    // an object without a path reads as its title / name (a milestone, a card, a person), not as JSON
    if (found && !path && value && typeof value === 'object' && !Array.isArray(value)) { const k = ['title', 'name', 'label', 'text', 'value'].find((x) => typeof value[x] === 'string' || typeof value[x] === 'number'); if (k) value = value[k]; }
    const str = found ? asText(value) : '';
    tokens.push({ raw, name: head, path, value: str, found, index: m.index });
    out += found ? str : m[0];
    last = m.index + m[0].length;
  }
  out += src.slice(last);
  return { text: out, tokens };
}
/** Variables from the `variables` slot: name = upstream title, value = the delivered value (connection order). */
function collectVars(ctx) {
  const ups = ctx.upstream('variables');
  const values = ctx.inputs.variables || [];
  // inputs.variables drops undefined values, so align by walking connections and reading each connection's value
  return ups.map((u, i) => ({ name: u.node.title, port: u.port.label, value: u.connection.value !== undefined ? u.connection.value : values[i] }));
}

export default registry.register({
  id: 'prompt', category: 'generate', label: 'Prompt', icon: icons.prompt, size: 'L',
  description: 'Prompt template with {variables} filled from the components plugged into it',
  inputs: [
    { key: 'variables', label: 'variables', type: 'any', multi: true, optional: true },
    { key: 'text', label: 'text', type: 'text', optional: true },
  ],
  outputs: [{ key: 'prompt', label: 'prompt', type: 'text' }],
  params: [
    { key: 'template', label: 'template', type: 'text', default: 'Write a short, upbeat launch tweet for {text}.', hidden: true },
  ],
  describeLink(from, toDef, to, n) { return to.key === 'prompt' ? `${n.from} is the prompt for ${n.to}` : `${n.fromPoss} prompt goes to ${n.to}`; },
  evaluate(ctx) {
    const vars = collectVars(ctx);
    const res = resolvePrompt(ctx.params.template, { vars, text: ctx.inputs.text });
    ctx.instance._resolved = res; ctx.instance._vars = vars;
    return { prompt: res.text };
  },
  footer: ({ instance, outputs }) => { const r = instance._resolved; const miss = r ? r.tokens.filter((t) => !t.found).length : 0; return `${(outputs.prompt || '').length} chars${r && r.tokens.length ? ` · ${r.tokens.length} variable${r.tokens.length > 1 ? 's' : ''}${miss ? ` · ${miss} missing` : ''}` : ''}`; },
  face: {
    render(g, w, h, { params, instance }) {
      clear(g, w, h);
      const res = instance._resolved || resolvePrompt(params.template, { vars: [] });
      drawCaps(g, 'prompt', PAD, PAD, { size: 11 });
      drawDivider(g, PAD, PAD + 16, w - 2 * PAD);
      // typeset: words flow, variables are chips with the resolved value
      const size = 22, lh = 34, chipH = 28;
      g.font = font(size, 500); g.textBaseline = 'middle';
      const parts = [];
      let last = 0; const src = String(params.template || '');
      for (const t of res.tokens) { parts.push({ text: src.slice(last, t.index) }); parts.push({ chip: t }); last = t.index + t.raw.length + 2; }
      parts.push({ text: src.slice(last) });
      let x = PAD, y = PAD + 40 + lh / 2; const maxX = w - PAD, maxY = h - 56;
      const newline = () => { x = PAD; y += lh; };
      for (const p of parts) {
        if (p.text !== undefined) {
          for (const seg of p.text.split(/(\n)/)) {
            if (seg === '\n') { newline(); continue; }
            for (const word of seg.split(/(\s+)/)) {
              if (!word) continue;
              g.font = font(size, 500);
              const ww = g.measureText(word).width;
              if (x + ww > maxX && x > PAD && !/^\s+$/.test(word)) newline();
              if (y > maxY) break;
              if (!/^\s+$/.test(word) || x > PAD) { g.fillStyle = palette.faceText; g.fillText(word, x, y); x += ww; }
            }
          }
        } else {
          const t = p.chip;
          const label = t.found ? (t.value === '' ? '(empty)' : fitLine(g, t.value, 340)) : `{${t.raw}}`;
          g.font = font(15, 600);
          const tw = g.measureText(label).width, cw = tw + 24;
          if (x + cw > maxX && x > PAD) newline();
          if (y > maxY) break;
          g.fillStyle = t.found ? palette.faceAccent : palette.faceWarn; roundRect(g, x, y - chipH / 2, cw, chipH, chipH / 2); g.fill();
          g.fillStyle = t.found ? '#fff' : '#1c2130'; g.fillText(label, x + 12, y + 1);
          // the variable's name in tiny caps above the chip
          g.font = font(9, 700); g.fillStyle = palette.faceDim; g.fillText(t.name.toUpperCase(), x + 12, y - chipH / 2 - 7);
          x += cw + 6;
        }
      }
      // footer line: variables available
      const vars = instance._vars || [];
      drawDivider(g, PAD, h - 44, w - 2 * PAD);
      g.font = font(13, 500); g.fillStyle = palette.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle';
      const avail = vars.length ? `variables: ${vars.map((v) => `{${v.name}}`).join(' ')}` : 'plug components into "variables" — their titles become {variables}';
      g.fillText(fitLine(g, avail, w - 2 * PAD - 90), PAD, h - 24);
      g.textAlign = 'right'; g.fillText(`${res.text.length} chars`, w - PAD, h - 24);
    },
  },
  panel(api, b) {
    const s = api.section('Prompt');
    const ta = api.area(s, 'template', () => b.params.template || '', (v) => api.setParam('template', v, 'template'), 'template', 6);
    ta.classList.add('prompt-editor');
    const chips = api.h('div', 'var-chips'); s.appendChild(chips);
    const insert = (name) => { const t = `{${name}}`; const a = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? a; ta.value = ta.value.slice(0, a) + t + ta.value.slice(e); ta.selectionStart = ta.selectionEnd = a + t.length; api.setParam('template', ta.value, 'template'); ta.focus(); };
    const renderChips = () => {
      const vars = b._vars || []; const names = [...vars.map((v) => v.name), 'text'];
      const sig = names.join('|'); if (chips.dataset.sig === sig) return; chips.dataset.sig = sig; chips.innerHTML = '';
      const lab = api.h('span', 'var-chips-label', names.length > 1 ? 'insert' : 'insert · connect components to add variables'); chips.appendChild(lab);
      for (const n of names) { const c = api.h('button', 'var-chip', `{${n}}`); c.type = 'button'; c.title = `Insert {${n}}`; c.addEventListener('click', () => insert(n)); chips.appendChild(c); }
    };
    renderChips(); api.live(renderChips);
    const prev = api.h('div', 'prompt-preview'); s.appendChild(prev);
    const renderPrev = () => { const r = b._resolved; if (!r) return; const html = escapeHTML(r.text).replace(/\{([^{}]+)\}/g, '<mark>{$1}</mark>'); if (prev.dataset.html !== html) { prev.dataset.html = html; prev.innerHTML = `<span class="prompt-preview-label">resolved · ${r.text.length} chars${r.tokens.some((t) => !t.found) ? ' · <em>' + r.tokens.filter((t) => !t.found).length + ' missing</em>' : ''}</span>${html || '<i>empty</i>'}`; } };
    renderPrev(); api.live(renderPrev);
  },
});
