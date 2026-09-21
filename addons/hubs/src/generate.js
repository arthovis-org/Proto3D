// generate.js — from a blueprint to pages and tasks.
//   pagesFor(params)        pure: page descriptors for the blueprint's client (real routes for the
//                           four known slugs, template defaults with status `planned` otherwise)
//   tasksFor(params, pages) pure: one task per enabled section in the shape the core PM model uses
//                           (kanban cards / Person / Timeline / Project Dashboard read `tasks`)
//   planGeneration(...)     pure: what to create and what to remove, keeping user-edited statuses
//   generate(host, node)    browser: one undoable command that removes the client's old pages,
//                           creates the new hub-page nodes in the Delivery flow beside the
//                           blueprint, selects and frames them, then pulses `generated`
import { SECTION_IDS, PHASES, sectionById, synthesizePages, joinUrl } from './template.js';
import { clientBySlug, pagesOf } from './clients.js';
import { layoutFlow } from './flows.js';

const str = (v) => String(v ?? '').trim();
const slugify = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** The slug a blueprint identifies its client by: the `slug` param, else the client name slugified. */
export const blueprintSlug = (params) => slugify(params.slug) || slugify(params.client);
const enabledSections = (params) => {
  const list = Array.isArray(params.sections) ? params.sections : typeof params.sections === 'string' ? params.sections.split(/[\s,]+/) : SECTION_IDS;
  const set = new Set(list.map(str).filter((id) => sectionById(id)));
  return set.size ? set : new Set(SECTION_IDS);
};

/** Page descriptors for a blueprint's params. Known slug → the real route list; unknown → template defaults. */
export function pagesFor(params = {}) {
  const slug = blueprintSlug(params);
  const enabled = enabledSections(params);
  const known = clientBySlug(slug);
  const status = params.status || (known ? 'live' : 'planned');
  if (known) {
    const base = str(params.baseUrl) || known.baseUrl;
    return pagesOf(known, { sections: [...enabled], status }).map((p) => ({ ...p, url: joinUrl(base, p.route), brand: params.brand || known.brand, lang: params.lang || known.lang }));
  }
  return synthesizePages({ baseUrl: str(params.baseUrl), sections: [...enabled], status: params.status || 'planned', slug }).map((p) => ({ ...p, brand: params.brand || '#5aa9ff', lang: params.lang || 'en' }));
}

const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (iso, n) => isoDate(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000);
/** Kanban column a delivery status maps onto (the core board's default columns). */
export const statusColumn = (status) => ({ planned: 'To do', building: 'In progress', live: 'Done' }[status] || 'To do');

/**
 * One task per enabled section, titled "<Section> for <Client>", in the core PM card shape
 * (src/pm/model.js createCard + flatCards: id, title, description, assignee, due, priority, tags,
 * checklist, estimate, createdAt, movedAt, blockedBy, column, done). `today` fixes the dates.
 */
export function tasksFor(params = {}, pages = pagesFor(params), { today = isoDate(Date.now()) } = {}) {
  const slug = blueprintSlug(params) || 'client';
  const client = str(params.client) || slug;
  const enabled = enabledSections(params);
  const status = params.status || (clientBySlug(slug) ? 'live' : 'planned');
  const out = [];
  for (const s of PHASES) {
    if (!enabled.has(s.id)) continue;
    const mine = pages.filter((p) => p.section === s.id);
    const done = status === 'live';
    const start = addDays(today, s.phase * 3), due = addDays(today, s.phase * 3 + 4);
    out.push({
      id: `hub-${slug}-${s.id}`, title: `${s.label} for ${client}`, description: mine.length ? mine.map((p) => p.title).join(' · ') : s.description,
      assignee: '', due, start, priority: s.phase <= 2 ? 'high' : 'medium', tags: [s.audience, slug],
      checklist: mine.map((p) => ({ text: p.title, done: p.status === 'live' })), estimate: Math.max(1, mine.length),
      createdAt: `${today}T00:00:00.000Z`, movedAt: `${today}T00:00:00.000Z`, blockedBy: [],
      column: statusColumn(status), done, section: s.id, client: slug, pages: mine.length,
    });
  }
  return out;
}
/** A core kanban `board` param with the tasks as cards in the column their status maps onto. */
export function boardFor(tasks) {
  const titles = ['To do', 'In progress', 'Review', 'Done'];
  return { columns: titles.map((title) => ({ title, cards: tasks.filter((t) => t.column === title).map(({ column, done, section, client, pages, start, ...card }) => card) })) };
}

/** Node params for a hub-page from a descriptor. */
export const pageParams = (d) => ({ url: d.url, title: d.title, section: d.section, audience: d.audience, role: d.role || '', device: d.device || 'desktop', status: d.status || 'planned', live: true, client: d.client || '', order: d.order ?? 0 });
/** The same key for a descriptor and for an existing hub-page node (url first, title + section as a fallback). */
const pageKey = (p) => `${str(p.url).toLowerCase()}|${str(p.section)}|${str(p.title).toLowerCase()}`;

/**
 * What a (re)generation does: `create` are descriptors (statuses of matching old pages preserved),
 * `remove` are the client's existing hub-page nodes. Pure; `existing` are nodes with `typeId` and `params`.
 */
export function planGeneration(params, existing = []) {
  const slug = blueprintSlug(params);
  const old = existing.filter((n) => n && n.typeId === 'hub-page' && str(n.params?.client) === slug && slug);
  const byKey = new Map(old.map((n) => [pageKey(n.params), n]));
  const byUrl = new Map(old.map((n) => [str(n.params.url).toLowerCase(), n]));
  const create = pagesFor(params).map((d) => {
    const prev = byKey.get(pageKey(d)) || byUrl.get(str(d.url).toLowerCase());
    return prev && prev.params.status !== d.status ? { ...d, status: prev.params.status, preserved: true } : d;
  });
  return { slug, create, remove: old, regenerate: old.length > 0 };
}

/**
 * Browser: create the pages for a blueprint node in the current world, undoably. Uses the core's
 * createInstance / commands / history through window.__proto (off-contract; see the README).
 */
export function generate(host, bp, { frame = true } = {}) {
  const proto = typeof window !== 'undefined' ? window.__proto : null;
  if (!proto || !bp) return null;
  const { world, history, cmd, createInstance } = proto;
  const plan = planGeneration(bp.params, world.nodes);
  if (!plan.create.length) { host.ui.toast('Nothing to generate: enable at least one section on the blueprint'); return null; }
  const nodes = plan.create.map((d) => createInstance('hub-page', { title: d.title, params: pageParams(d) }));
  // positions: the Delivery flow with the blueprint at its own place
  const items = [{ uid: bp.uid, type: 'hub-blueprint', params: bp.params, width: bp.width, height: bp.height }, ...nodes.map((n, i) => ({ uid: `new${i}`, type: 'hub-page', params: n.params, width: n.width, height: n.height }))];
  const pos = layoutFlow('delivery', items);
  const b0 = pos.get(bp.uid);   // the arc relative to where the blueprint already stands
  const dx = bp.position.x - b0.x, dz = bp.position.z - b0.z;
  const cmds = [];
  if (plan.remove.length) cmds.push(cmd.removeNodes(world, plan.remove));
  nodes.forEach((n, i) => { const p = pos.get(`new${i}`); n.rotation.y = p.ry; cmds.push(cmd.addNode(world, n, [p.x + dx, p.y + n.height / 2 + 0.4, p.z + dz])); });
  history.execute(cmd.composite(`${plan.regenerate ? 'Regenerate' : 'Generate'} ${nodes.length} pages`, cmds));
  bp.state.generatedAt = Date.now(); bp.state.generatedCount = nodes.length; bp.faceDirty = true;
  host.selection.set(nodes);
  if (frame) host.ui.frameBlocks([bp, ...nodes], { fill: 0.8 });
  host.ui.toast(`${plan.regenerate ? 'Regenerated' : 'Generated'} ${nodes.length} pages for ${str(bp.params.client) || plan.slug}${plan.create.some((d) => d.preserved) ? ' · edited statuses kept' : ''}`, 2600);
  try { proto.engine.emit(bp, 'generated', { slug: plan.slug, count: nodes.length }); } catch (_) { /* engine not ready */ }
  return { nodes, plan };
}
