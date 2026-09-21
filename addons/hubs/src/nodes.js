// nodes.js — the three hub- components, registered through host.nodes.register in the 'hubs'
// category:
//   hub-page       one deliverable page (XL). The canvas face is an app-like card: brand accent
//                  bar, section badge, title, route, audience / role chips, status dot and the
//                  device frame (browser chrome or phone bezel). It is the fallback whenever the
//                  live iframe (live-layer.js) is not shown, so it has to stand on its own.
//   hub-blueprint  the "fill in a client" form (XL): client, brand, base URL, the section
//                  checklist with page counts and the Generate / Regenerate button.
//   hub-section    a small header card (M) used as a lane / column label by the flows.
// `faceLayout` is shared with live-layer.js so the DOM frame lands exactly on the drawn frame.
// Browser-only behaviour (fly to a page, create nodes) is injected through `hooks` by index.js;
// in the headless engine the nodes still evaluate, emit and render on a stub 2D context.
import { SECTIONS, SECTION_IDS, AUDIENCES, DEVICES, STATUSES, LANGS, sectionById } from './template.js';
import { brandOf, clientBySlug } from './clients.js';
import { pagesFor, tasksFor, blueprintSlug } from './generate.js';

export const HUB_TYPES = Object.freeze(['hub-page', 'hub-blueprint', 'hub-section']);
export const CATEGORY = 'hubs';
const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
export const ICONS = Object.freeze({
  hubs: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>'),
  'hub-page': svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18"/><circle cx="6" cy="6.3" r=".6" fill="currentColor"/><circle cx="8.3" cy="6.3" r=".6" fill="currentColor"/><path d="M7 13h6M7 16h10"/>'),
  'hub-blueprint': svg('<path d="M8 4h8a2 2 0 012 2v13a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z"/><path d="M9 4v2h6V4"/><path d="M9 11l1.5 1.5L13 10M9 16h6"/>'),
  'hub-section': svg('<path d="M4 7h16M4 12h10M4 17h7"/>'),
});

/** Browser behaviour plugged in by index.js: open(instance) flies to / interacts with a page; generate(instance) creates its pages. */
export const hooks = { open: null, generate: null };
export function setHooks(h) { Object.assign(hooks, h); return hooks; }

let host = null;
const P = () => host.theme.palette;
const str = (v) => String(v ?? '');
const shortUrl = (url) => str(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
/** The route part of a page url for the header ("#/desk", "docs/plan.html"), else the short url. */
export function routeLabel(url) {
  const u = str(url);
  const i = u.indexOf('#'); if (i >= 0) return u.slice(i);
  const m = u.match(/^https?:\/\/[^/]+\/[^/]+\/(.+)$/); return m ? m[1] : shortUrl(u) || '—';
}
/** #rrggbb → rgba(r,g,b,a). */
export function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(str(hex).trim()); if (!m) return `rgba(90,169,255,${a})`;
  const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const DEVICE_PX = Object.freeze({ phone: { w: 390, h: 844 }, tablet: { w: 1024, h: 768 }, desktop: { w: 1280, h: 800 }, none: { w: 1280, h: 800 } });

/**
 * Where the frame sits on a hub-page face of `cw × ch` logical px, per device. Both the canvas face
 * and the CSS3D element derive from this, so they line up exactly.
 * @returns {{ frame, chrome, screen, bezel, aside, iframe: { w, h }, scale, element }}  rects are { x, y, w, h } in face px;
 *          `element` is the rect the live DOM element covers (chrome + screen, or the phone screen), `iframe` the page's CSS size.
 */
export function faceLayout(device, cw, ch) {
  const PAD = 28, HEADER = 104, BOTTOM = 24, CHROME = 34;
  const frame = { x: PAD, y: HEADER, w: cw - 2 * PAD, h: ch - HEADER - BOTTOM };
  const dev = DEVICES.includes(device) ? device : 'desktop';
  if (dev === 'phone') {
    const px = DEVICE_PX.phone; const margin = 12;
    const sh = frame.h - 2 * margin, sw = Math.round(sh * px.w / px.h);
    const sx = Math.round(frame.x + frame.w * 0.68 - sw / 2), sy = frame.y + margin;
    const screen = { x: sx, y: sy, w: sw, h: sh };
    const bezel = { x: sx - margin, y: sy - margin, w: sw + 2 * margin, h: sh + 2 * margin };
    const aside = { x: frame.x, y: frame.y, w: bezel.x - frame.x - 28, h: frame.h };
    return { device: dev, frame, chrome: null, screen, bezel, aside, iframe: { w: px.w, h: px.h }, scale: sw / px.w, element: screen };
  }
  if (dev === 'tablet') {
    const px = DEVICE_PX.tablet;
    const sh = frame.h - CHROME, sw = Math.min(frame.w, Math.round(sh * px.w / px.h));
    const sx = Math.round(frame.x + frame.w / 2 - sw / 2);
    const chrome = { x: sx, y: frame.y, w: sw, h: CHROME };
    const screen = { x: sx, y: frame.y + CHROME, w: sw, h: sh };
    const element = { x: sx, y: frame.y, w: sw, h: frame.h };
    return { device: dev, frame, chrome, screen, bezel: null, aside: null, iframe: { w: px.w, h: Math.round(px.w * sh / sw) }, scale: sw / px.w, element };
  }
  const px = DEVICE_PX.desktop;
  const chrome = dev === 'none' ? null : { x: frame.x, y: frame.y, w: frame.w, h: CHROME };
  const screen = chrome ? { x: frame.x, y: frame.y + CHROME, w: frame.w, h: frame.h - CHROME } : { ...frame };
  return { device: dev, frame, chrome, screen, bezel: null, aside: null, iframe: { w: px.w, h: Math.round(px.w * screen.h / screen.w) }, scale: screen.w / px.w, element: { ...frame } };
}

/* ---------- small drawing helpers on top of host.draw ---------- */
function chip(g, text, x, y, { h = 24, bg = null, color = null, size = 13, weight = 600, padX = 10, dot = null, maxW = 260 } = {}) {
  const { roundRect, font } = host.draw;
  g.font = font(size, weight);
  let t = str(text); while (t.length > 3 && g.measureText(t).width > maxW - 2 * padX) t = t.slice(0, -2) + '…';
  const tw = g.measureText(t).width;
  const w = Math.ceil(tw + padX * 2 + (dot ? h * 0.6 : 0));
  g.fillStyle = bg || P().faceCard; roundRect(g, x, y, w, h, h / 2); g.fill();
  let tx = x + padX;
  if (dot) { g.fillStyle = dot; g.beginPath(); g.arc(x + padX + h * 0.2, y + h / 2, h * 0.19, 0, Math.PI * 2); g.fill(); tx += h * 0.6; }
  g.fillStyle = color || P().faceText; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, tx, y + h / 2 + 0.5);
  return w;
}
function fillRound(g, r, radius, fill, stroke = null) {
  const { roundRect } = host.draw;
  roundRect(g, r.x, r.y, r.w, r.h, radius); g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
}
const statusColor = (status) => (status === 'live' ? P().faceGood : status === 'building' ? P().faceWarn : P().faceDim);
const statusWord = (status) => (status === 'live' ? 'Live' : status === 'building' ? 'Building' : 'Planned');

/** Draw the device frame (browser chrome + screen or phone bezel) with its placeholder content. */
function drawFrame(g, L, { url, status, section, audience, role, brand, live }) {
  const { drawText } = host.draw; const pal = P();
  const s = sectionById(section);
  if (L.device === 'phone') {
    fillRound(g, L.bezel, 30, '#0d1117', pal.faceLine);
    fillRound(g, L.screen, 20, pal.faceCard);
    g.fillStyle = '#0d1117'; host.draw.roundRect(g, L.screen.x + L.screen.w / 2 - 34, L.screen.y + 8, 68, 14, 7); g.fill();   // the notch
    if (L.aside && L.aside.w > 120) {
      let y = L.aside.y + 4;
      drawText(g, s?.description || '', L.aside.x, y, L.aside.w, 84, { size: 18, min: 13, color: pal.faceDim, align: 'left', valign: 'top', weight: 500 });
      y += 100;
      drawText(g, `${audience || s?.audience || ''}${role ? ` · ${role}` : ''}`, L.aside.x, y, L.aside.w, 26, { size: 15, color: pal.faceText, align: 'left', weight: 600 });
      y += 40;
      drawText(g, shortUrl(url), L.aside.x, y, L.aside.w, 44, { size: 13, min: 11, color: pal.faceDim, align: 'left', valign: 'top', mono: true });
      drawText(g, status === 'live' ? (live ? 'Click to open the live app →' : 'Live frames are off') : `${statusWord(status)} · no live frame`, L.aside.x, L.aside.y + L.aside.h - 30, L.aside.w, 26, { size: 15, color: status === 'live' ? pal.faceAccent : pal.faceDim, align: 'left', weight: 600 });
    }
    placeholder(g, L.screen, { status, live, url, compact: true });
    return;
  }
  if (L.chrome) {
    fillRound(g, { x: L.chrome.x, y: L.chrome.y, w: L.chrome.w, h: L.chrome.h + 12 }, 12, pal.faceCard);
    [pal.faceBad, pal.faceWarn, pal.faceGood].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(L.chrome.x + 18 + i * 16, L.chrome.y + L.chrome.h / 2, 5, 0, Math.PI * 2); g.fill(); });
    drawText(g, shortUrl(url) || '—', L.chrome.x + 72, L.chrome.y + 4, L.chrome.w - 90, L.chrome.h - 8, { size: 13, min: 11, color: pal.faceDim, align: 'left', mono: true });
  }
  fillRound(g, L.screen, L.chrome ? 0 : 12, pal.faceBg, pal.faceLine);
  if (L.chrome) { g.strokeStyle = pal.faceLine; g.lineWidth = 1.5; host.draw.roundRect(g, L.chrome.x, L.chrome.y, L.chrome.w, L.chrome.h + L.screen.h, 12); g.stroke(); }
  if (L.device === 'tablet' && L.screen.x - L.frame.x > 150) {
    const aw = L.screen.x - L.frame.x - 24;
    drawText(g, s?.description || '', L.frame.x, L.frame.y + 6, aw, 120, { size: 16, min: 12, color: pal.faceDim, align: 'left', valign: 'top' });
    drawText(g, `${audience || ''}${role ? ` · ${role}` : ''}`, L.frame.x, L.frame.y + 136, aw, 26, { size: 14, color: pal.faceText, align: 'left', weight: 600 });
  }
  placeholder(g, L.screen, { status, live, url, brand });
}
/** What the screen shows while no iframe covers it. */
function placeholder(g, r, { status, live, compact = false }) {
  const { drawText } = host.draw; const pal = P();
  const size = compact ? 15 : 22;
  const line1 = status === 'live' ? (live ? 'Live page' : 'Live frames off') : statusWord(status);
  const line2 = status === 'live' ? (live ? (compact ? 'loads when near' : 'appears when the camera is near · click to open') : 'showing the card only') : status === 'building' ? 'in progress' : 'not built yet';
  const cy = r.y + r.h / 2;
  g.fillStyle = statusColor(status); g.beginPath(); g.arc(r.x + r.w / 2, cy - size * 1.4, compact ? 6 : 9, 0, Math.PI * 2); g.fill();
  drawText(g, line1, r.x + 12, cy - size * 0.6, r.w - 24, size * 1.5, { size, color: pal.faceText, weight: 600 });
  drawText(g, line2, r.x + 12, cy + size * 0.9, r.w - 24, size * 1.3, { size: Math.round(size * 0.68), min: 10, color: pal.faceDim });
}

/* ---------- hub-page ---------- */
export const descriptorOf = (params) => ({ url: str(params.url), title: str(params.title), section: params.section, audience: params.audience, role: str(params.role), device: params.device, status: params.status, live: params.live !== false, client: str(params.client), order: +params.order || 0 });
export function openPage(instance, source = 'event') {
  if (!instance) return false;
  instance.state.opens = (instance.state.opens || 0) + 1; instance.state.lastOpen = source;
  try { instance.emit?.('opened', descriptorOf(instance.params)); } catch (_) { /* no engine yet */ }
  try { hooks.open?.(instance, source); } catch (e) { console.warn('[hubs] open hook failed:', e); }
  return true;
}
function renderPage(g, w, h, { params, palette }) {
  const { clear, drawText } = host.draw; const pal = palette || P();
  const brand = brandOf(params.client, pal.faceAccent);
  const L = faceLayout(params.device, w, h);
  clear(g, w, h);
  // brand accent bar down the left edge, inside the rounded corner
  g.fillStyle = brand; host.draw.roundRect(g, 0, 0, 26, h, 14); g.fill(); g.fillStyle = pal.faceBg; g.fillRect(10, 0, 18, h);
  // row 1: section badge, audience / role chips; status at the right
  const s = sectionById(params.section);
  let x = L.frame.x, y = 22;
  x += chip(g, s?.label || params.section || 'page', x, y, { bg: rgba(brand, 0.22), color: pal.faceText, weight: 700 }) + 8;
  if (params.audience) x += chip(g, params.audience, x, y, { bg: pal.faceCard, color: pal.faceDim }) + 8;
  if (params.role) x += chip(g, params.role, x, y, { bg: pal.faceCard, color: pal.faceDim }) + 8;
  if (params.device && params.device !== 'none') chip(g, params.device, x, y, { bg: pal.faceCard, color: pal.faceDim });
  const st = statusWord(params.status); g.font = host.draw.font(13, 600); const stw = g.measureText(st).width + 34;
  chip(g, st, L.frame.x + L.frame.w - stw, y, { bg: pal.faceCard, color: pal.faceText, dot: statusColor(params.status) });
  // row 2: title left, route right (mono, dim)
  const routeW = Math.round(L.frame.w * 0.34);
  drawText(g, params.title || 'Untitled page', L.frame.x, 52, L.frame.w - routeW - 16, 42, { size: 32, min: 18, color: pal.faceText, weight: 700, align: 'left' });
  drawText(g, routeLabel(params.url), L.frame.x + L.frame.w - routeW, 60, routeW, 26, { size: 16, min: 11, color: pal.faceDim, mono: true, align: 'right' });
  drawFrame(g, L, { url: params.url, status: params.status, section: params.section, audience: params.audience, role: params.role, brand, live: params.live !== false });
}
const pageDef = {
  id: 'hub-page', category: CATEGORY, label: 'Hub page', size: 'XL', icon: ICONS['hub-page'],
  description: 'One deliverable page of a client hub; shows the real page live when the camera is near',
  inputs: [{ key: 'open', label: 'open', type: 'event', optional: true }],
  outputs: [{ key: 'page', label: 'page', type: 'data' }, { key: 'opened', label: 'opened', type: 'event' }],
  params: [
    { key: 'url', label: 'url', type: 'text', default: '' },
    { key: 'title', label: 'title', type: 'text', default: 'Page' },
    { key: 'section', label: 'section', type: 'select', options: [...SECTION_IDS], default: 'site' },
    { key: 'audience', label: 'audience', type: 'select', options: [...AUDIENCES], default: 'customers' },
    { key: 'role', label: 'role', type: 'text', default: '' },
    { key: 'device', label: 'device', type: 'select', options: [...DEVICES], default: 'desktop' },
    { key: 'status', label: 'status', type: 'select', options: [...STATUSES], default: 'planned' },
    { key: 'live', label: 'live frame', type: 'boolean', default: true },
    { key: 'client', label: 'client slug', type: 'text', default: '' },
    { key: 'order', label: 'order', type: 'number', default: 0, min: 0, max: 999, step: 1 },
  ],
  onEvent(ctx, key) { if (key === 'open') openPage(ctx.instance, 'event'); },
  evaluate({ params }) { return { page: descriptorOf(params) }; },
  footer: ({ params }) => `${sectionById(params.section)?.short || params.section} · ${statusWord(params.status).toLowerCase()} · ${params.device}`,
  face: {
    render: renderPage,
    onPointer(ctx, ev) { if (ev.type === 'click') { openPage(ctx.instance, 'face'); return true; } return false; },
  },
};

/* ---------- hub-blueprint ---------- */
/** Rects of the blueprint face: the section rows (hit-testable) and the Generate button. */
export function blueprintLayout(w, h) {
  const PAD = 28; const colX = Math.round(w * 0.47); const rowH = Math.min(30, Math.floor((h - 60 - 78) / SECTIONS.length));
  const rows = SECTIONS.map((s, i) => ({ id: s.id, x: colX, y: 56 + i * rowH, w: w - PAD - colX, h: rowH }));
  const button = { x: w - PAD - 250, y: h - 70, w: 250, h: 46 };
  return { PAD, colX, rows, button, left: { x: PAD, y: 22, w: colX - PAD - 24, h: h - 44 } };
}
const enabledOf = (params) => { const list = Array.isArray(params.sections) ? params.sections : SECTION_IDS; const set = new Set(list.map(str)); return set.size ? set : new Set(SECTION_IDS); };
/** hub-page nodes of this blueprint's client currently in the world. */
export const pagesOnCanvas = (instance) => { const slug = blueprintSlug(instance.params); return (instance.world?.nodes || []).filter((n) => n.typeId === 'hub-page' && str(n.params?.client).trim() === slug && slug); };
function blueprintCache(instance, params) {
  const sig = JSON.stringify([params, new Date().toISOString().slice(0, 10)]);
  const c = instance._hub || (instance._hub = {});
  if (c.sig !== sig) { c.sig = sig; c.pages = pagesFor(params); c.tasks = tasksFor(params, c.pages); }
  return c;
}
export function requestGenerate(instance, source = 'event') {
  if (!instance) return false;
  instance.state.generateRequests = (instance.state.generateRequests || 0) + 1;
  if (hooks.generate) { try { hooks.generate(instance, source); return true; } catch (e) { console.warn('[hubs] generate hook failed:', e); } }
  const pages = pagesFor(instance.params);
  instance.state.generatedCount = pages.length; instance.state.generatedAt = Date.now();
  try { instance.emit?.('generated', { slug: blueprintSlug(instance.params), count: pages.length, pages }); } catch (_) { /* no engine */ }
  return true;
}
function renderBlueprint(g, w, h, { params, instance, palette }) {
  const { clear, drawText, roundRect, font } = host.draw; const pal = palette || P();
  const L = blueprintLayout(w, h);
  const brand = str(params.brand) || pal.faceAccent;
  const pages = pagesFor(params); const enabled = enabledOf(params);
  const known = clientBySlug(blueprintSlug(params));
  const existing = pagesOnCanvas(instance);
  clear(g, w, h);
  // left: identity
  fillRound(g, { x: L.PAD, y: 22, w: 46, h: 46 }, 12, brand);
  drawText(g, str(params.client) || 'New client', L.PAD + 60, 18, L.left.w - 60, 36, { size: 30, min: 18, color: pal.faceText, weight: 700, align: 'left' });
  drawText(g, `${str(params.industry) || 'industry'} · ${known ? 'known hub' : 'from template'}`, L.PAD + 60, 52, L.left.w - 60, 20, { size: 14, color: pal.faceDim, align: 'left' });
  g.fillStyle = pal.faceLine; g.fillRect(L.PAD, 84, L.left.w, 1.5);
  const row = (label, y) => { g.font = font(11, 700); g.fillStyle = pal.faceDim; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(label.toUpperCase(), L.PAD, y); };
  row('Base URL', 108);
  drawText(g, str(params.baseUrl) || 'https://…', L.PAD, 114, L.left.w, 44, { size: 14, min: 11, color: pal.faceText, mono: true, align: 'left', valign: 'top' });
  row('Slug · language · brand', 178);
  let x = L.PAD;
  x += chip(g, blueprintSlug(params) || 'slug', x, 186, { bg: pal.faceCard, color: pal.faceText, size: 12 }) + 6;
  x += chip(g, str(params.lang || 'en').toUpperCase(), x, 186, { bg: pal.faceCard, color: pal.faceDim, size: 12 }) + 6;
  chip(g, brand, x, 186, { bg: rgba(brand, 0.22), color: pal.faceText, size: 12, dot: brand });
  row('Roles', 240);
  const roles = str(params.roles).split(',').map((r) => r.trim()).filter(Boolean);
  x = L.PAD; let ry = 248;
  for (const r of roles.slice(0, 8)) { g.font = font(12, 600); const cw = g.measureText(r).width + 20; if (x + cw > L.PAD + L.left.w) { x = L.PAD; ry += 30; if (ry > 330) break; } x += chip(g, r, x, ry, { bg: pal.faceCard, color: pal.faceDim, size: 12 }) + 6; }
  if (!roles.length) drawText(g, 'front desk, owner, …', L.PAD, 248, L.left.w, 24, { size: 13, color: pal.faceDim, align: 'left' });
  row('Status', Math.max(ry + 48, 328));
  chip(g, statusWord(params.status), L.PAD, Math.max(ry + 56, 336), { bg: pal.faceCard, color: pal.faceText, dot: statusColor(params.status) });
  drawText(g, existing.length ? `${existing.length} pages on the canvas · regenerate keeps edited statuses` : `${pages.length} pages will be created in the Delivery flow`, L.PAD, h - 66, L.button.x - L.PAD - 20, 40, { size: 13, min: 11, color: pal.faceDim, align: 'left' });
  // right: section checklist with counts
  g.font = font(11, 700); g.fillStyle = pal.faceDim; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText('SECTIONS', L.colX, 40);
  g.textAlign = 'right'; g.fillText(`${pages.length} PAGES · ${[...enabled].length} ON`, w - L.PAD, 40);
  for (const r of L.rows) {
    const s = sectionById(r.id); const on = enabled.has(r.id); const n = pages.filter((p) => p.section === r.id).length;
    const box = { x: r.x, y: r.y + (r.h - 18) / 2, w: 18, h: 18 };
    roundRect(g, box.x, box.y, box.w, box.h, 5);
    if (on) { g.fillStyle = brand; g.fill(); g.strokeStyle = '#ffffff'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(box.x + 4.5, box.y + 9.5); g.lineTo(box.x + 8, box.y + 13); g.lineTo(box.x + 14, box.y + 5.5); g.stroke(); }
    else { g.strokeStyle = pal.faceDim; g.lineWidth = 1.5; g.stroke(); }
    g.font = font(15, on ? 600 : 500); g.fillStyle = on ? pal.faceText : pal.faceDim; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(s.label, r.x + 30, r.y + r.h / 2 + 0.5);
    const lw = g.measureText(s.label).width;
    g.font = font(12, 500); g.fillStyle = pal.faceDim; g.fillText(s.audience, r.x + 38 + lw, r.y + r.h / 2 + 1);
    g.font = font(13, 600); g.fillStyle = on && n ? pal.faceText : pal.faceDim; g.textAlign = 'right';
    g.fillText(on ? (n ? `${n} page${n > 1 ? 's' : ''}` : '—') : 'off', w - L.PAD, r.y + r.h / 2 + 0.5);
  }
  // the button
  const B = L.button;
  fillRound(g, B, 12, brand);
  drawText(g, `${existing.length ? 'Regenerate' : 'Generate'} ${pages.length} page${pages.length === 1 ? '' : 's'}`, B.x, B.y, B.w, B.h, { size: 17, min: 13, color: '#ffffff', weight: 700 });
}
const blueprintDef = {
  id: 'hub-blueprint', category: CATEGORY, label: 'Hub blueprint', size: 'XL', icon: ICONS['hub-blueprint'],
  description: 'Fill in a client and generate its deliverable pages; outputs the page list and one task per section',
  inputs: [{ key: 'generate', label: 'generate', type: 'event', optional: true }],
  outputs: [
    { key: 'pages', label: 'pages', type: 'data' },
    { key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks' },
    { key: 'count', label: 'count', type: 'number' },
    { key: 'generated', label: 'generated', type: 'event' },
  ],
  params: [
    { key: 'client', label: 'client', type: 'text', default: 'New client' },
    { key: 'slug', label: 'slug', type: 'text', default: '' },
    { key: 'brand', label: 'brand', type: 'color', default: '#5aa9ff' },
    { key: 'lang', label: 'language', type: 'select', options: [...LANGS], default: 'en' },
    { key: 'baseUrl', label: 'base URL', type: 'text', default: '' },
    { key: 'industry', label: 'industry', type: 'text', default: '' },
    { key: 'roles', label: 'roles (comma-separated)', type: 'text', default: '' },
    { key: 'sections', label: 'sections', type: 'json', default: [...SECTION_IDS] },
    { key: 'status', label: 'status', type: 'select', options: [...STATUSES], default: 'planned' },
  ],
  onEvent(ctx, key) { if (key === 'generate') requestGenerate(ctx.instance, 'event'); },
  evaluate({ params, instance }) { const c = blueprintCache(instance, params); return { pages: c.pages, tasks: c.tasks, count: c.pages.length }; },
  footer: ({ params, instance }) => { const c = blueprintCache(instance, params); return `${c.pages.length} pages · ${c.tasks.length} sections · ${statusWord(params.status).toLowerCase()}`; },
  face: {
    render: renderBlueprint,
    onPointer(ctx, ev) {
      if (ev.type !== 'click') return false;
      const { instance } = ctx; const f = instance.face || { cw: 1013, ch: 552 };
      const px = ev.u * f.cw, py = ev.v * f.ch;
      const L = blueprintLayout(f.cw, f.ch);
      const inside = (r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
      if (inside(L.button)) { requestGenerate(instance, 'face'); return true; }
      const row = L.rows.find(inside);
      if (row) {   // toggle a section on the checklist
        const set = enabledOf(instance.params); if (set.has(row.id)) set.delete(row.id); else set.add(row.id);
        instance.params.sections = SECTION_IDS.filter((id) => set.has(id));
        instance.world?.changed?.('param');
        return true;
      }
      return false;
    },
  },
};

/* ---------- hub-section ---------- */
function renderSection(g, w, h, { params, palette }) {
  const { clear, drawText } = host.draw; const pal = palette || P();
  const s = sectionById(params.section) || SECTIONS[0];
  const brand = brandOf(params.client, pal.faceAccent);
  clear(g, w, h);
  g.fillStyle = brand; host.draw.roundRect(g, 0, 0, 22, h, 14); g.fill(); g.fillStyle = pal.faceBg; g.fillRect(8, 0, 16, h);
  drawText(g, s.label, 26, 18, w - 52, 40, { size: 28, min: 16, color: pal.faceText, weight: 700, align: 'left' });
  let x = 26;
  x += chip(g, s.audience, x, 66, { bg: rgba(brand, 0.22), color: pal.faceText, size: 12 }) + 6;
  if (params.client) chip(g, params.client, x, 66, { bg: pal.faceCard, color: pal.faceDim, size: 12 });
  drawText(g, s.description, 26, 104, w - 52, h - 122, { size: 16, min: 12, color: pal.faceDim, align: 'left', valign: 'top' });
}
const sectionDef = {
  id: 'hub-section', category: CATEGORY, label: 'Hub section', size: 'M', icon: ICONS['hub-section'],
  description: 'A section header card: name, audience and a one-line description; the flows use it as a lane or column label',
  inputs: [],
  outputs: [{ key: 'section', label: 'section', type: 'data' }],
  params: [
    { key: 'section', label: 'section', type: 'select', options: [...SECTION_IDS], default: 'site' },
    { key: 'client', label: 'client slug', type: 'text', default: '' },
  ],
  evaluate({ params }) { const s = sectionById(params.section); return { section: s ? { id: s.id, label: s.label, audience: s.audience, phase: s.phase, client: str(params.client) } : null }; },
  footer: ({ params }) => sectionById(params.section)?.audience || '',
  face: { render: renderSection },
};

/** Register the three hub- components and their icons. Called once per page from index.js `register(host)`. */
export function registerNodes(h) {
  host = h;
  for (const [name, icon] of Object.entries(ICONS)) host.icons.set(name, icon);
  return [pageDef, blueprintDef, sectionDef].map((d) => host.nodes.register(d));
}
export const isHubNode = (n) => !!n && HUB_TYPES.includes(n.typeId);
