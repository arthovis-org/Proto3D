// template.js — the deliverable-hub template every client hub follows: eleven sections in
// delivery order, each with an audience, a default device and a one-line description. The
// four real hubs on imagine-os.github.io (clients.js) all instantiate this structure; a blueprint
// for an unknown client synthesises default routes from it (`synthesizePages`).
export const SECTIONS = Object.freeze([
  { id: 'hub', label: 'Testing hub', short: 'Hub', audience: 'everyone', phase: 0, device: 'desktop', description: 'The landing page: one card per surface, enter-as-role buttons, live captures and a stat strip' },
  { id: 'site', label: 'Public website', short: 'Website', audience: 'customers', phase: 1, device: 'desktop', description: 'Marketing pages for the business: home, services, pricing, proposal, what it replaces' },
  { id: 'app', label: 'Customer app', short: 'App', audience: 'customers', phase: 2, device: 'phone', description: 'The customer-facing app in a phone shell, with sign-in, bookings, payments and account flows' },
  { id: 'staff', label: 'Staff surfaces by role', short: 'Staff', audience: 'staff', phase: 3, device: 'desktop', description: 'One desk per role: front desk, specialists, teachers, brokers; gated by the role matrix' },
  { id: 'owner', label: 'Owner & admin', short: 'Owner', audience: 'owner', phase: 4, device: 'desktop', description: 'Owner dashboard, settings, catalogue, finance, approvals, audit and backups' },
  { id: 'manual', label: 'Ops manual', short: 'Manual', audience: 'staff', phase: 5, device: 'tablet', description: 'Bilingual chapters for the day-to-day, plus the list of open owner decisions' },
  { id: 'docs', label: 'Docs & knowledge', short: 'Docs', audience: 'developers', phase: 6, device: 'desktop', description: 'Architecture, changelog, data model, flow map, search and the knowledge base' },
  { id: 'plan', label: 'Project management', short: 'Plan', audience: 'owner', phase: 7, device: 'desktop', description: 'Kanban, list, timeline and graph of the build plan; passes and task detail' },
  { id: 'dev', label: 'Design system & dev tools', short: 'Dev tools', audience: 'developers', phase: 8, device: 'desktop', description: 'Design tokens, component library, route manifest, rules, role matrix, table library' },
  { id: 'mockups', label: 'Mockups & device gallery', short: 'Mockups', audience: 'everyone', phase: 9, device: 'tablet', description: 'Every page as a capture tile, the device simulator and screenshot galleries' },
  { id: 'machine', label: 'Machine surface', short: 'Machine', audience: 'machine', phase: 10, device: 'desktop', description: 'The actions registry (WebMCP), the route manifest and URL-driven state for agents' },
]);
export const SECTION_IDS = Object.freeze(SECTIONS.map((s) => s.id));
export const AUDIENCES = Object.freeze(['everyone', 'customers', 'staff', 'owner', 'developers', 'machine']);
export const DEVICES = Object.freeze(['desktop', 'tablet', 'phone', 'none']);
export const STATUSES = Object.freeze(['planned', 'building', 'live']);
export const LANGS = Object.freeze(['en', 'es']);

const byId = new Map(SECTIONS.map((s) => [s.id, s]));
export const sectionById = (id) => byId.get(id) || null;
export const phaseOf = (sectionId) => byId.get(sectionId)?.phase ?? 99;
/** Sections in delivery (phase) order. */
export const PHASES = Object.freeze([...SECTIONS].sort((a, b) => a.phase - b.phase));

/** Default routes an unknown client gets from the template alone (hash routes like the Vite hubs). */
export const DEFAULT_ROUTES = Object.freeze({
  hub: [{ route: '#/', title: 'Testing hub' }],
  site: [{ route: '#/site', title: 'Public website' }, { route: '#/site/pricing', title: 'Pricing' }],
  app: [{ route: '#/app', title: 'Customer app', device: 'phone' }],
  staff: [{ route: '#/desk', title: 'Front desk', role: 'front desk' }],
  owner: [{ route: '#/admin', title: 'Admin', role: 'admin' }],
  manual: [{ route: '#/manual', title: 'Ops manual' }],
  docs: [{ route: '#/docs', title: 'Docs' }],
  plan: [{ route: '#/plan', title: 'Plan board' }],
  dev: [{ route: '#/dev/tokens', title: 'Design tokens' }, { route: '#/dev/components', title: 'Components' }],
  mockups: [{ route: '#/dev/simulator', title: 'Simulator' }],
  machine: [{ route: '#/dev/actions', title: 'Actions registry' }],
});

/** Join a base URL and a route ("#/x", "docs/index.html", "index.html#roles"). */
export function joinUrl(baseUrl, route) {
  const base = String(baseUrl || '').trim();
  const r = String(route || '');
  if (!base) return r;
  if (/^https?:\/\//.test(r)) return r;
  const b = base.endsWith('/') ? base : base + (r.startsWith('#') ? '/' : '/');
  return b + r.replace(/^\.?\//, '');
}

/**
 * Page descriptors for a client that is not in clients.js: the template's default routes under
 * `baseUrl`, one delivery `order` per page, status `planned` unless the caller says otherwise.
 */
export function synthesizePages({ baseUrl = '', sections = SECTION_IDS, status = 'planned', slug = '' } = {}) {
  const enabled = new Set(sections);
  const out = [];
  for (const s of PHASES) {
    if (!enabled.has(s.id)) continue;
    for (const r of DEFAULT_ROUTES[s.id] || []) {
      out.push({ url: joinUrl(baseUrl, r.route), route: r.route, title: r.title, section: s.id, audience: s.audience, role: r.role || '', device: r.device || s.device, status, client: slug, order: out.length });
    }
  }
  return out;
}
