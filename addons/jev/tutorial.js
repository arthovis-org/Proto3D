// tutorial.js — the movable tutorial card. It never traps anything: a fixed card the person drags
// by its header (6 px dead zone, clamped to the viewport with an 8 px margin, touch-friendly),
// collapses to a slim pill, docks to the bottom-left or bottom-right, and remembers its position
// and state in `proto3d.jev.tutorial.v1`. Content: a demo picker, numbered steps with "Do it"
// (performs the step) and "Show me" (frames the target and rings it with a spotlight that fades
// after 2 s; Esc hides it). No global keys are taken beyond Esc for the ring.
import * as THREE from 'three';
import { demos, named } from './scenes/index.js';
import { SAMPLE_MESSAGES } from './scenes/route-message.js';
import { PASS_PROMPT, FAIL_PROMPT } from './scenes/guard-generation.js';
import { INTENTS } from './scenes/smart-build.js';
import { kick } from './components/common.js';
import { ui } from '../../src/ai/ui-hooks.js';

export const TUTORIAL_KEY = 'proto3d.jev.tutorial.v1';
const MARGIN = 8, DEAD = 6, SPOT_MS = 2000, PILLS = 56;   // PILLS: the status pill / badge row along the bottom
const DOCS = 'https://docs.typesafe.ai/';

/* ------------------------------------------------------------------ */
/* steps                                                                */
/* ------------------------------------------------------------------ */
const ABOUT = {
  title: 'About Jev', text: 'Jev is TypeSafe AI\'s "System One" model: no text, no chat — it answers typed questions (yes / no, pick one, score on a ladder) with calibrated probabilities in 70–500 ms, for $0.042 per million input tokens. Here it is the decision layer of the node graph: routing, gating, scoring, ranking, choosing components by intent. Everything runs on a simulated decider until you add a key (see Go live).',
  link: { label: 'docs.typesafe.ai', url: DOCS }, target: () => [],
};
const GO_LIVE = {
  title: 'Go live', text: 'Open File → Connections… (or press Do it), paste a TypeSafe key into the Jev card and press Test. The very same nodes then call api.typesafe.ai: the badge on each face turns from Simulated to Live, the footer shows the model, latency and cost, and the session spend appears in the status pill. If the browser blocks the call, set the proxy URL (the repo ships proxy/cloudflare-worker.js).',
  target: () => [], doit: { label: 'Open Connections', run: () => ui.openConnections('jev') },
};
const STEPS = {
  'route-message': [
    ABOUT,
    { title: 'A message arrives', text: 'The Text node holds the customer message and shows it on the phone. Double-click the text on its face to type your own.', target: (n) => [n.message, n.phone].filter(Boolean) },
    { title: 'Route by meaning', text: 'One choice question: "Which team should handle this?" with three lanes as options — Returns, Shipping, Billing — each with a one-line description. Jev returns the winner, a probability per lane and a confidence. The bars on the face are that answer.', target: (n) => [n.route].filter(Boolean), doit: { label: 'Decide again', run: (c) => c.named.route && kick(c.named.route) } },
    { title: 'Try the samples', text: 'Swap the message and watch the desk that lights up. Each lane event carries the text, an Action passes it on and the desk laptop shows it.', target: (n) => [n.route, n.returns, n.shipping, n.billing].filter(Boolean), extra: SAMPLE_MESSAGES.slice(0, 3).map((m) => ({ label: m.length > 34 ? m.slice(0, 33) + '…' : m, run: (c) => c.setText(c.named.message, m) })) },
    { title: 'Below the floor: unsure', text: 'The confidence floor (0.6 here) turns a doubtful decision into the `unsure` event instead of a wrong desk: "hello??" goes to Ask a human. That is the act / confirm / escalate shape TypeSafe recommends, as a port.', target: (n) => [n.route, n.human].filter(Boolean), doit: { label: 'Send "hello??"', run: (c) => c.setText(c.named.message, SAMPLE_MESSAGES[3]) } },
    { title: 'Change the lanes', text: 'Select the router and open the properties panel: lanes are rows you can add, rename and describe; the threshold and auto / manual mode sit above. A saved scene keeps the last answer too.', target: (n) => [n.route].filter(Boolean), doit: { label: 'Open its panel', run: (c) => c.select(c.named.route) } },
  ],
  'guard-generation': [
    { title: 'A request comes in', text: 'The Prompt node holds a request for the Generate node. Before any money is spent it passes through a Yes / no check.', target: (n) => [n.prompt].filter(Boolean) },
    { title: 'The check', text: 'One noul question — "on-topic for a product launch and free of personal data?" — with what true and false mean. Jev answers a probability; at or above the threshold `pass` fires, below it `fail`.', target: (n) => [n.check].filter(Boolean), doit: { label: 'Check again', run: (c) => c.named.check && kick(c.named.check) } },
    { title: 'Pass → generate', text: 'A clean launch request passes: `pass` presses Run on Generate Text (offline Demo provider here) and the draft appears.', target: (n) => [n.check, n.gen, n.draft].filter(Boolean), doit: { label: 'Send the clean request', run: (c) => c.setTemplate(c.named.prompt, PASS_PROMPT) } },
    { title: 'Fail → blocked', text: 'A request carrying a phone number and an email fails the check: nothing is generated, the Blocked display lights up instead.', target: (n) => [n.check, n.blocked].filter(Boolean), doit: { label: 'Send the risky request', run: (c) => c.setTemplate(c.named.prompt, FAIL_PROMPT) } },
    { title: 'What it costs', text: 'The check reads a few hundred input tokens: about $0.00003 live. The generation it guards costs hundreds of times more on a hosted model — and a guardrail that fast can sit in front of every Action.', target: (n) => [n.note].filter(Boolean) },
  ],
  'triage-board': [
    { title: 'A board of work', text: 'Eight cards in plain language: crashes, outages, typos and nice-to-haves. Their priority fields are all "medium" — the wording is the only signal.', target: (n) => [n.board].filter(Boolean) },
    { title: 'Rank a list', text: 'The board\'s tasks output feeds Rank a list. One score question per card ("how urgent for the launch?", five levels) goes out in a single request; the answer is a sorted list with a level and a confidence per card.', target: (n) => [n.rank].filter(Boolean), doit: { label: 'Rank again', run: (c) => c.named.rank && kick(c.named.rank) } },
    { title: 'Read the order', text: 'The Display shows the ranking as text and the sticky note takes the top item — both are plain outputs, so a Timeline, a Person or a device screen could read them just as well.', target: (n) => [n.order, n.top].filter(Boolean) },
    { title: 'Score one card', text: 'Score on a rubric grades a single card the Data node picks off the board. Change the path to grade another one.', target: (n) => [n.pick, n.score].filter(Boolean), doit: { label: 'Pick the next card', run: (c) => c.nextPick(c.named.pick) } },
  ],
  'smart-build': [
    { title: 'Nearly empty', text: 'Four pictures and a person. Instead of hunting the Add toolbar, tell the system what you want and let Jev choose the component.', target: (n) => [...(n.media || []), n.maya].filter(Boolean) },
    { title: '"Put these images on a wall"', text: 'Select the pictures and press Ctrl+J. Jev gets one choice question whose options are every component in the registry (label + description); the winner is added beside the selection and linked wherever an output fits an input.', target: (n) => n.media || [], doit: { label: 'Do it for me', run: (c) => c.smart(c.named.media, INTENTS.wall) } },
    { title: '"Show the person\'s tasks on a board"', text: 'Now select Maya and ask again: a Kanban board arrives with her plugged into its people slot. The alternatives Jev weighed stay clickable in the bar.', target: (n) => [n.maya].filter(Boolean), doit: { label: 'Do it for me', run: (c) => c.smart([c.named.maya], INTENTS.tasks) } },
    { title: 'Behind the scenes', text: 'Nothing was generated: a 35-option choice, ~2 KB of state, one round trip. The same pattern can pick cable types, group blocks by intent, or turn a sentence into a command — see the roadmap in the README.', target: () => [] },
    GO_LIVE,
  ],
};

/* ------------------------------------------------------------------ */
/* the card                                                             */
/* ------------------------------------------------------------------ */
export class Tutorial {
  /** @param {object} o { proto, loadDemo(id), currentDemo() → id, smartAdd, frame(blocks, opts), el, spot } */
  constructor({ proto, loadDemo, currentDemo, smartAdd, frame = null, el = document.getElementById('jev-tutorial'), spot = document.getElementById('jev-spot') }) {
    Object.assign(this, { proto, loadDemo, currentDemo, smartAdd, el, spot });
    this.frame = frame || ((blocks, opts) => proto.ws.frameBlocks(blocks, { ...opts, insetLeft: proto.leftBar?.isOpen ? 300 : 0 }));
    this.state = { open: true, collapsed: false, pos: null, dock: 'right', demo: null, step: 0, ...read() };
    this.demoId = this.state.demo || demos[0].id; this.step = this.state.step || 0;
    this.spotBlocks = null; this.spotUntil = 0; this._raf = 0;
    this._build();
    this._bindDrag();
    window.addEventListener('resize', () => this._clamp());
    // a taller step or a jobs tray appearing under the card re-seats a docked card (a dragged one only stays inside the viewport)
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => this._clamp()); ro.observe(this.el); const tray = document.getElementById('bottom-right'); if (tray) ro.observe(tray); }
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.spotBlocks) this.hideSpot(); });
    if (this.state.open) this.open(); else this.el.hidden = true;
  }
  get isOpen() { return !this.el.hidden; }
  get steps() { return STEPS[this.demoId] || []; }

  _build() {
    const $ = (s) => this.el.querySelector(s);
    const ic = this.proto.icons;
    $('.jt-grip').innerHTML = ic.more || '⋮';
    $('.jt-dock-l').innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="5" y="12" width="7" height="6" rx="1.2" fill="currentColor" stroke="none"/></svg>';
    $('.jt-dock-r').innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="12" y="12" width="7" height="6" rx="1.2" fill="currentColor" stroke="none"/></svg>';
    $('.jt-collapse').innerHTML = ic.collapse || '–';
    $('.jt-close').innerHTML = ic.close || '×';
    $('.jt-dock-l').addEventListener('click', () => this.dock('left'));
    $('.jt-dock-r').addEventListener('click', () => this.dock('right'));
    $('.jt-collapse').addEventListener('click', () => this.setCollapsed(!this.state.collapsed));
    $('.jt-close').addEventListener('click', () => this.close());
    $('.jt-back').addEventListener('click', () => this.go(this.step - 1));
    $('.jt-next').addEventListener('click', () => this.next());
    $('.jt-showme').addEventListener('click', () => this.showMe());
    this.demosEl = $('.jt-demos'); this.stepNo = $('.jt-stepno'); this.stepTitle = $('.jt-steptitle'); this.stepText = $('.jt-steptext'); this.actions = $('.jt-actions'); this.count = $('.jt-count');
    this.backBtn = $('.jt-back'); this.nextBtn = $('.jt-next'); this.showBtn = $('.jt-showme');
  }

  /* ---------- open / close / collapse / dock ---------- */
  open() { this.el.hidden = false; this.setDemo(this.currentDemo?.() || this.demoId, { keepStep: true }); this._place(); this.state.open = true; this._save(); }
  close() { this.el.hidden = true; this.hideSpot(); this.state.open = false; this._save(); }
  toggle() { this.isOpen ? this.close() : this.open(); }
  setCollapsed(v) { this.state.collapsed = !!v; this.el.classList.toggle('collapsed', this.state.collapsed); this.el.querySelector('.jt-collapse').innerHTML = this.state.collapsed ? (this.proto.icons.expand || '+') : (this.proto.icons.collapse || '–'); this._clamp(); this._save(); }
  dock(side) { this.state.dock = side; this.state.pos = null; this._place(); this._save(); }
  /**
   * Docked: the bottom corner of the canvas, above the pill row (status pill, badge) and above the
   * jobs tray when it is showing — the demos' blocks sit in the upper part of the view, so the
   * lower corners are the free space. Or the remembered free position after a drag.
   */
  _place() {
    if (!this.isOpen) return;
    const r = this.el.getBoundingClientRect();
    if (this.state.pos) { this._setPos(this.state.pos.x, this.state.pos.y); return; }
    const rail = document.body.classList.contains('rail-hidden') ? 0 : cssPx('--rail-w', 60);
    const panel = document.body.classList.contains('panel-hidden') ? 0 : cssPx('--panel-w', 300);
    const x = this.state.dock === 'left' ? rail + 12 : window.innerWidth - panel - r.width - 12;
    let above = window.innerHeight - PILLS;
    const tray = document.getElementById('bottom-right');
    if (this.state.dock !== 'left' && tray) { const t = tray.getBoundingClientRect(); if (t.height > 0) above = Math.min(above, t.top); }
    this._setPos(x, above - r.height - MARGIN);
  }
  _setPos(x, y) {
    const r = this.el.getBoundingClientRect();
    const cx = Math.max(MARGIN, Math.min(window.innerWidth - r.width - MARGIN, x));
    const cy = Math.max(cssPx('--top-h', 60) + MARGIN, Math.min(window.innerHeight - r.height - MARGIN, y));
    this.el.style.left = `${Math.round(cx)}px`; this.el.style.top = `${Math.round(cy)}px`;
    this.el.style.transform = 'none';
    return { x: cx, y: cy };
  }
  _clamp() { if (this.isOpen) { if (this.state.pos) this.state.pos = this._setPos(this.state.pos.x, this.state.pos.y); else this._place(); } }
  _bindDrag() {
    const head = this.el.querySelector('.jt-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
      const move = (ev) => {
        if (ev.pointerId !== d.id) return;
        if (!d.moved) { if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DEAD) return; d.moved = true; this.el.classList.add('dragging'); }
        this.state.pos = this._setPos(ev.clientX - d.ox, ev.clientY - d.oy);
      };
      const up = (ev) => {
        if (ev.pointerId !== d.id) return;
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        this.el.classList.remove('dragging');
        if (d.moved) this._save(); else if (this.state.collapsed && !ev.target.closest('button')) this.setCollapsed(false);
      };
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    });
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && !this.state.collapsed) this.setCollapsed(true); });   // a click already expands the pill
  }

  /* ---------- demos and steps ---------- */
  setDemo(id, { keepStep = false } = {}) {
    if (!STEPS[id]) id = demos[0].id;
    const changed = id !== this.demoId;
    this.demoId = id; this.state.demo = id;
    if (changed || !keepStep) this.step = 0;
    this.step = Math.max(0, Math.min(this.steps.length - 1, this.step));
    this._renderDemos(); this._renderStep(); this._save();
  }
  go(i) { if (i < 0 || i >= this.steps.length) return; this.step = i; this.state.step = i; this._renderStep(); this._save(); this.showMe({ quiet: true }); }
  next() {
    if (this.step >= this.steps.length - 1) {
      const k = demos.findIndex((d) => d.id === this.demoId); const nxt = demos[(k + 1) % demos.length];
      this.loadDemo(nxt.id); this.setDemo(nxt.id); this.showMe({ quiet: true }); return;
    }
    this.go(this.step + 1);
  }
  _renderDemos() {
    this.demosEl.innerHTML = '';
    demos.forEach((d, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'jt-demo' + (d.id === this.demoId ? ' on' : ''); b.dataset.demo = d.id;
      b.innerHTML = `<span class="jt-demo-n">${i + 1}</span><span>${d.label}</span>`; b.title = d.description;
      b.addEventListener('click', () => { if (this.currentDemo?.() !== d.id) this.loadDemo(d.id); this.setDemo(d.id); this.showMe({ quiet: true }); });
      this.demosEl.appendChild(b);
    });
  }
  _renderStep() {
    const s = this.steps[this.step]; if (!s) return;
    const n = this.steps.length;
    this.stepNo.textContent = `Step ${this.step + 1} of ${n}`;
    this.count.textContent = `${this.step + 1} / ${n}`;
    this.stepTitle.textContent = s.title;
    this.stepText.textContent = s.text;
    this.actions.innerHTML = '';
    if (s.link) { const a = document.createElement('a'); a.href = s.link.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'jt-link'; a.textContent = `${s.link.label} ↗`; this.actions.appendChild(a); }
    if (s.doit) { const b = document.createElement('button'); b.type = 'button'; b.className = 'jt-doit'; b.dataset.action = 'doit'; b.textContent = s.doit.label; b.addEventListener('click', () => this.doIt()); this.actions.appendChild(b); }
    for (const x of s.extra || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'jt-extra'; b.textContent = x.label; b.title = x.label; b.addEventListener('click', () => this._run(x.run)); this.actions.appendChild(b); }
    this.backBtn.disabled = this.step === 0;
    const last = this.step === n - 1;
    this.nextBtn.textContent = last ? 'Next demo →' : 'Next';
    this.showBtn.disabled = !(s.target?.(this._named()) || []).length;
  }
  _named() { const d = demos.find((x) => x.id === this.demoId); return d ? named(this.proto.world, d) : {}; }
  /** What "Do it" hands a step: the named blocks and a few undoable helpers. */
  _ctx() {
    const { proto } = this; const { world, history, selection, cmd } = proto;
    return {
      proto, named: this._named(), frame: this.frame,
      setText: (node, text) => { if (node) { history.execute(cmd.setParam(world, node, 'text', text)); proto.engine.evaluate(); } },
      setTemplate: (node, text) => { if (node) { history.execute(cmd.setParam(world, node, 'template', text)); proto.engine.evaluate(); } },
      nextPick: (node) => { if (!node) return; const m = /\[(\d+)\]/.exec(String(node.params.path || '[0]')); const i = ((m ? +m[1] : 0) + 1) % 8; history.execute(cmd.setParam(world, node, 'path', `[${i}].title`)); },
      select: (node) => { if (node) { selection.set([node]); proto.togglePanel(true); this.frame([node], { fill: 0.7 }); } },
      smart: async (nodes, intent) => { const list = (nodes || []).filter(Boolean); if (!list.length) return null; selection.set(list); this.smartAdd.open(intent); return this.smartAdd.run(intent); },
    };
  }
  _run(fn) { try { return fn(this._ctx()); } catch (e) { this.proto.overlays?.toast?.(`Could not do that: ${e.message}`, 2400); return null; } }
  doIt() { const s = this.steps[this.step]; if (!s?.doit) return null; const r = this._run(s.doit.run); this.showSpot(s.target?.(this._named()) || []); return r; }
  /** Frame the step's blocks and ring them. */
  showMe({ quiet = false } = {}) {
    const s = this.steps[this.step]; const blocks = (s?.target?.(this._named()) || []).filter(Boolean);
    if (!blocks.length) { this.hideSpot(); return; }
    this.frame(blocks, { fill: blocks.length === 1 ? 0.7 : 0.88 });
    if (!quiet) this.showSpot(blocks, SPOT_MS * 1.5); else this.showSpot(blocks);
  }

  /* ---------- the spotlight ring ---------- */
  showSpot(blocks, ms = SPOT_MS) {
    const list = (blocks || []).filter(Boolean);
    if (!list.length) return;
    this.spotBlocks = list; this.spotUntil = performance.now() + ms;
    this.spot.hidden = false; this.spot.classList.remove('fade');
    if (!this._raf) this._tick();
  }
  hideSpot() { this.spotBlocks = null; this.spot.hidden = true; if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; } }
  _tick() {
    this._raf = 0;
    if (!this.spotBlocks) return;
    const now = performance.now();
    if (now > this.spotUntil) { this.spot.classList.add('fade'); if (now > this.spotUntil + 300) { this.hideSpot(); return; } }
    const r = projectBlocks(this.spotBlocks, this.proto.ws);
    if (r) Object.assign(this.spot.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    this._raf = requestAnimationFrame(() => this._tick());
  }
  _save() { write({ open: this.isOpen, collapsed: this.state.collapsed, pos: this.state.pos, dock: this.state.dock, demo: this.demoId, step: this.step }); }
}

/* ---------- helpers ---------- */
function read() { try { return JSON.parse(localStorage.getItem(TUTORIAL_KEY) || '{}') || {}; } catch (_) { return {}; } }
function write(s) { try { localStorage.setItem(TUTORIAL_KEY, JSON.stringify(s)); } catch (_) { /* private mode */ } }
function cssPx(name, fallback) { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(v) ? v : fallback; }
const _v = new THREE.Vector3();
/** Screen bounding box of the blocks' bodies (their 8 corners projected), padded; null when all are behind the camera. */
function projectBlocks(blocks, ws) {
  const cam = ws.camera, r = ws.renderer.domElement.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const b of blocks) {
    const w = (b.width || 3) / 2, h = (b.height || 2) / 2, d = (b.depth || 0.5) / 2, oy = b.kind === 'device' ? h : 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      _v.set(sx * w, oy + sy * h, sz * d); b.localToWorld(_v); _v.project(cam);
      if (_v.z > 1) continue;
      const x = r.left + (_v.x + 1) / 2 * r.width, y = r.top + (1 - _v.y) / 2 * r.height;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); any = true;
    }
  }
  if (!any) return null;
  const pad = 10;
  return { left: minX - pad, top: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}
