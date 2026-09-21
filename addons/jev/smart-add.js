// smart-add.js — "Ask to add" (Ctrl+J): the system helps build the system. The person types an
// intent ("put these images on a wall"); Jev gets ONE choice question whose options are every
// registered component (label + description, the selected types left out, plus "none"). The
// winner is added beside the selection through the undo history and, when a selected block has an
// output that fits one of its inputs (`world.canConnect`), linked to it. The top-3 alternatives
// stay clickable as chips so a near miss is one click away.
import { client } from './jev-client.js';
import { pct } from './components/common.js';

const MAX_OPTIONS = 254;   // + "none" = the API's 255-option ceiling

export class SmartAdd {
  /** @param {object} proto window.__proto  @param {object} o { toast(text, ms), frame(blocks, opts), el } */
  constructor(proto, { toast = () => {}, frame = null, el = document.getElementById('jev-ask') } = {}) {
    Object.assign(this, { proto, toast, el });
    this.frame = frame || ((blocks, opts) => proto.ws.frameBlocks(blocks, { ...opts, insetLeft: proto.leftBar?.isOpen ? 300 : 0 }));
    this.input = el.querySelector('.ja-input'); this.result = el.querySelector('.ja-result');
    this.busy = false; this.lastAdd = null; this.last = null;
    el.querySelector('.ja-ic').innerHTML = proto.icons.jev || '';
    el.querySelector('.ja-close').innerHTML = proto.icons.close || '×';
    el.querySelector('.ja-go').addEventListener('click', () => this.run());
    el.querySelector('.ja-close').addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); this.run(); } else if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); e.stopPropagation(); this.toggle(); }
    }, true);
  }
  get isOpen() { return !this.el.hidden; }
  open(prefill) {
    this.el.hidden = false;
    if (typeof prefill === 'string') this.input.value = prefill;
    this._hint();
    setTimeout(() => { this.input.focus(); this.input.select(); }, 20);
  }
  close() { this.el.hidden = true; }
  toggle() { this.isOpen ? this.close() : this.open(); }
  _hint() {
    const sel = this.selected();
    this.input.placeholder = sel.length ? `Ask for a component to add next to ${sel.length === 1 ? sel[0].title : sel.length + ' selected blocks'}…` : 'Ask the system to build: “put these images on a wall”';
  }
  selected() { return this.proto.selection.nodes.filter((n) => (n.kind === 'node' || n.kind === 'device') && n.world); }

  /** The question: every component the registry knows, minus the selected types, plus "none". */
  question(intent) {
    const excluded = new Set(this.selected().map((n) => n.typeId));
    const defs = this.proto.registry.all().filter((d) => !excluded.has(d.id)).slice(0, MAX_OPTIONS);
    // a criteria value is one string (the API's shape); the label leads so it weighs in the reading
    const criteria = Object.fromEntries(defs.map((d) => [d.id, d.description ? `${d.label}: ${d.description}` : d.label]));
    criteria.none = 'Nothing in this list fits the request';
    return { component: { type: 'choice', instructions: 'Which component should be added to the 3D workspace for this request? Pick "none" when nothing fits.', criteria } };
  }
  /** Ask Jev; returns { picks: [{ id, def, p }], answer } — picks sorted by probability, "none" kept in place. */
  async ask(intent) {
    const q = this.question(intent);
    const res = await client.decide({ state: `Request: ${intent}`, questions: q });
    const a = res.answers.component;
    const picks = Object.entries(a.probabilities || {}).sort((x, y) => y[1] - x[1]).map(([id, p]) => ({ id, p, def: id === 'none' ? null : this.proto.registry.get(id) })).filter((x) => x.id === 'none' || x.def);
    return { picks, answer: a, res };
  }
  /** Type → run: decide, add, link, show alternatives. Resolves { node, links, picks } (node null when Jev said none). */
  async run(intentText = this.input.value) {
    const intent = String(intentText || '').trim();
    if (!intent || this.busy) return null;
    this.busy = true; this.el.classList.add('busy'); this._say('Asking Jev…');
    try {
      const { picks, answer, res } = await this.ask(intent);
      const top = picks[0];
      const sel = this.selected();
      let node = null, links = [];
      if (top && top.id !== 'none' && top.def) ({ node, links } = this.place(top.def, sel));
      this.last = { intent, picks, answer, node, links, sel, simulated: res.simulated };   // `sel`: the alternatives link to the same blocks
      this._renderResult();
      const tag = `Jev ${pct(answer.probabilities?.[answer.choice])}${res.simulated ? ', simulated' : ''}`;
      if (node) this.toast(`Added ${top.def.label}${links.length ? ` and linked it to ${links.map((l) => l.from.owner.title).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 3).join(', ')}` : ''} (${tag})`, 2600);
      else this.toast(`Jev found nothing that fits "${intent}" (${tag})`, 2400);
      return { node, links, picks };
    } catch (e) {
      this._say(`Could not ask Jev: ${e.message}`, true);
      return null;
    } finally { this.busy = false; this.el.classList.remove('busy'); }
  }
  /** Add `def` beside the selection and link it to what fits, as one undoable command. */
  place(def, sel = this.selected()) {
    const { world, history, selection, ws, cmd, createInstance } = this.proto;
    sel = sel.filter((n) => n && n.world && (n.kind === 'node' || n.kind === 'device'));   // never a group frame or a removed block
    const node = createInstance(def);
    const near = sel.length ? { x: Math.max(...sel.map((n) => n.position.x + n.width / 2)) + 4 + node.width / 2, z: sel.reduce((a, n) => a + n.position.z, 0) / sel.length } : { x: ws.controls.target.x, z: ws.controls.target.z };
    const pos = world.nextFreeSlot(near, node);
    const cmds = [cmd.addNode(world, node, pos)];
    const links = [];
    for (const s of sel) {
      const pair = firstFit(world, s.outputs, node.inputs) || firstFit(world, node.outputs, s.inputs);
      if (pair) { links.push(pair); cmds.push(cmd.connect(world, pair.from, pair.to)); }
    }
    const c = cmd.composite(`Add ${def.label} (Jev)`, cmds);
    history.execute(c);
    this.lastAdd = { cmd: c, node };
    selection.set([node]);
    this.frame([...sel, node], { fill: 0.8 });
    return { node, links };
  }
  /** A chip was clicked: take the previous add back (when it is still the last command) and add this one instead. */
  pickAlternative(id) {
    const def = this.proto.registry.get(id); if (!def) return null;
    const { history } = this.proto;
    if (this.lastAdd && history.undoStack?.[history.undoStack.length - 1] === this.lastAdd.cmd) { history.undo(); }
    // the blocks the first pick was linked to (the add selected the new node, so the live selection is not them); only what is still in the world
    const sel = (this.last?.sel || []).filter((n) => n.world);
    const r = this.place(def, sel.length ? sel : this.selected());
    if (this.last) { this.last.node = r.node; this.last.links = r.links; this.last.answer = { ...this.last.answer, choice: id }; }
    this._renderResult();
    this.toast(`Added ${def.label} instead${r.links.length ? ' and linked it' : ''}`, 1800);
    return r;
  }
  _say(text, bad = false) { this.result.hidden = false; this.result.classList.toggle('bad', bad); this.result.textContent = text; }
  _renderResult() {
    const L = this.last; if (!L) return;
    this.result.hidden = false; this.result.classList.remove('bad'); this.result.innerHTML = '';
    const line = document.createElement('span'); line.className = 'ja-line';
    line.textContent = L.node ? `Added ${L.node.def.label}${L.links.length ? ` · linked ${L.links.map((l) => `${l.from.owner.title} → ${l.to.label}`).join(', ')}` : ''}` : 'Nothing fits — try other words';
    this.result.appendChild(line);
    const alts = L.picks.filter((p) => p.id !== L.answer.choice && p.id !== 'none').slice(0, 3);
    if (alts.length) {
      const wrap = document.createElement('span'); wrap.className = 'ja-alts';
      const lab = document.createElement('span'); lab.className = 'ja-alts-label'; lab.textContent = 'or:'; wrap.appendChild(lab);
      for (const a of alts) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ja-chip'; b.dataset.id = a.id; b.innerHTML = `${a.def.icon || ''}<span>${a.def.label}</span><small>${pct(a.p)}</small>`; b.addEventListener('click', () => this.pickAlternative(a.id)); wrap.appendChild(b); }
      this.result.appendChild(wrap);
    }
    const tag = document.createElement('small'); tag.className = 'ja-tag'; tag.textContent = `${L.simulated ? 'Simulated' : 'Live'} · ${pct(L.answer.probabilities?.[L.answer.choice])} · confidence ${pct(L.answer.confidence)}`; this.result.appendChild(tag);
  }
}
/** The first (output, input) pair that can take a cable, in port order. */
function firstFit(world, outs, ins) {
  for (const from of outs) for (const to of ins) if (world.canConnect(from, to)) return { from, to };
  return null;
}
