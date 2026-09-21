// examples.js — the demo scenes, in the core example shape ({ id, label, focus, build({ add,
// connect, group }) }) and loaded through host.examples.build():
//   one per client   a blueprint with its pages in the Delivery flow, grouped per section, a core
//                    Timeline fed by the blueprint's `tasks` output and a core Kanban Board whose
//                    cards are the same tasks (the board has no `tasks` input, so it is pre-filled)
//   compare          all four clients in the Compare flow (clients as rows × sections as columns)
//   new-client       one blank blueprint and a sticky note saying what to fill in
// `makeExamples(host)` looks up which core components exist (`host.nodes.has`) so a headless test
// registry without the PM components still builds the hub part.
import { CLIENTS, blueprintParams } from './clients.js';
import { PHASES } from './template.js';
import { pagesFor, tasksFor, boardFor, pageParams } from './generate.js';
import { layoutFlow } from './flows.js';

/** Add a blueprint and its pages at the flow positions; returns { bp, pages: [node], byId }. */
function addClient(api, params, { flow = 'delivery', origin = [0, 0], groups = true } = {}) {
  const descriptors = pagesFor(params);
  const items = [{ uid: 'bp', type: 'hub-blueprint', params }, ...descriptors.map((d, i) => ({ uid: `p${i}`, type: 'hub-page', params: pageParams(d) }))];
  const pos = layoutFlow(flow, items, { origin });
  const at = (uid) => { const p = pos.get(uid); return [p[0], null, p[2]]; };
  const bp = api.add('hub-blueprint', at('bp'), { title: params.client, params });
  const pages = descriptors.map((d, i) => api.add('hub-page', at(`p${i}`), { title: d.title, params: pageParams(d) }));
  if (groups) for (const s of PHASES) { const members = pages.filter((n) => n.params.section === s.id); if (members.length) api.group(s.label, members); }
  return { bp, pages, descriptors };
}

export function clientExample(client, has = () => false) {
  const params = blueprintParams(client);
  return {
    id: `hub-${client.slug}`, label: `${client.name} · deliverable hub`, client: client.slug,
    description: `${client.industry}: blueprint → ${pagesFor(params).length} live pages in the Delivery flow, one task per section on a timeline and a kanban`,
    // the opening shot: the blueprint and the first pages, close enough (< LOD distance) for their live frames to load
    focus: (named) => [named.bp, ...(named.pages || []).slice(0, 4)].filter(Boolean),
    build(api) {
      const { bp, pages, descriptors } = addClient(api, params);
      const named = { bp, pages };
      const tasks = tasksFor(params, descriptors);
      if (has('timeline')) { named.timeline = api.add('timeline', [bp.position?.x ?? 0, null, 15], { title: `${client.name} · delivery plan` }); api.connect(bp, 'tasks', named.timeline, 'tasks'); }
      if (has('kanban-board')) named.board = api.add('kanban-board', [(bp.position?.x ?? 0) + 16, null, 15], { title: `${client.name} · build board`, params: { board: boardFor(tasks), peopleView: 'auto' } });
      return named;
    },
  };
}

export function compareExample() {
  return {
    id: 'hub-compare', label: 'All four clients · compare',
    description: 'The four blueprints with their pages in the Compare flow: the same section of every client lines up in a column',
    focus: (named) => [...(named.bps || []).slice(0, 1), ...(named.pages || []).filter((n) => ['hub', 'site', 'app'].includes(n.params.section))],
    build(api) {
      const all = CLIENTS.map((c) => blueprintParams(c));
      const items = [];
      all.forEach((params, ci) => { items.push({ uid: `bp${ci}`, type: 'hub-blueprint', params }); pagesFor(params).forEach((d, i) => items.push({ uid: `p${ci}-${i}`, type: 'hub-page', params: pageParams(d), title: d.title })); });
      const pos = layoutFlow('compare', items);
      const bps = [], pages = [];
      for (const it of items) {
        const p = pos.get(it.uid);
        const n = api.add(it.type, [p[0], null, p[2]], { title: it.type === 'hub-blueprint' ? it.params.client : it.title, params: it.params });
        (it.type === 'hub-blueprint' ? bps : pages).push(n);
      }
      return { bps, pages };
    },
  };
}

export function newClientExample(has = () => false) {
  return {
    id: 'hub-new-client', label: 'New client · blank blueprint',
    description: 'One empty blueprint: fill in the client, slug, brand and base URL, tick the sections, click Generate pages',
    focus: (named) => [named.bp, named.note].filter(Boolean),
    build(api) {
      const bp = api.add('hub-blueprint', [0, null, 0], { title: 'New client', params: { client: 'New client', slug: '', brand: '#5aa9ff', lang: 'en', baseUrl: 'https://imagine-os.github.io/<repo>/', industry: '', roles: 'front desk, owner', status: 'planned' } });
      const named = { bp };
      if (has('sticky-note')) named.note = api.add('sticky-note', [-8.5, null, 1.5], { title: 'How to', params: { text: 'Fill in the blueprint: client name, slug, brand colour, base URL, roles. Untick sections you do not need. Click “Generate pages” on the card — Ctrl+Z undoes it.', colour: '#f5d76e' } });
      return named;
    },
  };
}

/** Every demo, in menu order. `has(typeId)` tells which core components the page has. */
export function makeExamples(host) {
  const has = (id) => { try { return host.nodes.has(id); } catch (_) { return false; } };
  return [...CLIENTS.map((c) => clientExample(c, has)), compareExample(), newClientExample(has)];
}
