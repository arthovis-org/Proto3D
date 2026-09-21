// clients.js — the four real client hubs on imagine-os.github.io, as data: name, slug, brand,
// language, base URL, industry, roles and the page list (section → route, title, audience, role,
// device). Routes come from the recon of the live sites (all four are iframe-embeddable: no
// X-Frame-Options, no CSP). Add a client here, or fill a hub-blueprint node on the canvas.
import { SECTIONS, sectionById, joinUrl, PHASES } from './template.js';

/** Section is required; audience / device default from the template section, `order` is assigned by `pagesOf`. */
export const CLIENTS = Object.freeze([
  {
    slug: 'cal-tenant-law', name: 'CTL OS', brand: '#1F4E79', lang: 'en', industry: 'California tenant law firm',
    baseUrl: 'https://imagine-os.github.io/cal-tenant-law/', roles: ['front desk', 'attorney', 'paralegal', 'owner', 'admin'],
    pages: [
      { section: 'hub', route: '#/', title: 'Testing hub' },
      { section: 'site', route: '#/site', title: 'Public website' },
      { section: 'site', route: '#/site/proposal', title: 'Proposal' },
      { section: 'app', route: '#/app', title: 'Client app', role: 'tenant', device: 'phone' },
      { section: 'staff', route: '#/desk', title: 'Front desk', role: 'front desk' },
      { section: 'staff', route: '#/counsel', title: 'Attorneys', role: 'attorney' },
      { section: 'staff', route: '#/assist', title: 'Paralegals', role: 'paralegal' },
      { section: 'staff', route: '#/board', title: 'Game board', role: 'case team' },
      { section: 'owner', route: '#/owner', title: 'Owner', role: 'owner' },
      { section: 'owner', route: '#/admin', title: 'Admin', role: 'admin' },
      { section: 'plan', route: '#/plan', title: 'Plan board' },
      { section: 'manual', route: '#/manual', title: 'Ops manual' },
      { section: 'docs', route: '#/docs', title: 'Docs' },
      { section: 'docs', route: '#/legal', title: 'Legal memory', audience: 'staff', role: 'attorney' },
      { section: 'dev', route: '#/dev/tokens', title: 'Design tokens' },
      { section: 'dev', route: '#/dev/components', title: 'Components' },
      { section: 'dev', route: '#/dev/routes', title: 'Route manifest' },
      { section: 'dev', route: '#/dev/roles', title: 'Role matrix' },
      { section: 'mockups', route: '#/dev/canvas', title: 'Canvas' },
      { section: 'mockups', route: '#/dev/simulator', title: 'Simulator' },
      { section: 'machine', route: '#/dev/actions', title: 'Actions registry' },
    ],
  },
  {
    slug: 'petrock', name: 'Petrock', brand: '#E07A3F', lang: 'en', industry: 'Dog hotel and spa',
    baseUrl: 'https://imagine-os.github.io/petrock/', roles: ['front desk', 'groomer', 'owner', 'super admin'],
    pages: [
      { section: 'hub', route: '#/', title: 'Testing hub' },
      { section: 'site', route: '#/site', title: 'Public website' },
      { section: 'site', route: '#/site/pricing', title: 'Pricing' },
      { section: 'app', route: '#/app', title: 'Customer app', role: 'pet parent', device: 'phone' },
      { section: 'staff', route: '#/desk', title: 'Front desk', role: 'front desk' },
      { section: 'staff', route: '#/staff/pin', title: 'Staff PIN login', role: 'staff', device: 'tablet' },
      { section: 'owner', route: '#/admin', title: 'Owner / admin', role: 'owner' },
      { section: 'manual', route: '#/manual', title: 'Ops manual' },
      { section: 'docs', route: '#/docs', title: 'Docs' },
      { section: 'dev', route: '#/dev/tokens', title: 'Design tokens' },
      { section: 'dev', route: '#/dev/components', title: 'Components' },
      { section: 'dev', route: '#/dev/routes', title: 'Route manifest' },
      { section: 'dev', route: '#/dev/rules', title: 'Rules registry' },
      { section: 'mockups', route: '#/docs/screenshots', title: 'Screenshots' },
      { section: 'mockups', route: '#/dev/qa/screenshots', title: 'QA screenshots' },
    ],
  },
  {
    slug: 'hoy', name: 'HoyOS', brand: '#2E7DD1', lang: 'es', industry: 'Wellness center',
    baseUrl: 'https://imagine-os.github.io/hoy/', roles: ['recepción', 'profesor', 'admin', 'dueño'],
    pages: [
      { section: 'hub', route: '#/', title: 'Centro de pruebas' },
      { section: 'site', route: '#/site', title: 'Sitio web' },
      { section: 'site', route: '#/site/schedule', title: 'Horario' },
      { section: 'app', route: '#/app', title: 'App de clientes', role: 'cliente', device: 'phone' },
      { section: 'staff', route: '#/teach', title: 'App de profesores', role: 'profesor', device: 'tablet' },
      { section: 'staff', route: '#/staff', title: 'Personal', role: 'recepción' },
      { section: 'staff', route: '#/staff/checkin', title: 'Check-in', role: 'recepción', device: 'tablet' },
      { section: 'owner', route: '#/admin', title: 'Admin', role: 'admin' },
      { section: 'owner', route: '#/admin/finance', title: 'Finanzas', role: 'dueño' },
      { section: 'manual', route: '#/manual', title: 'Manual de operaciones' },
      { section: 'manual', route: '#/manual/decisions', title: 'Decisiones' },
      { section: 'docs', route: '#/docs', title: 'Documentación' },
      { section: 'docs', route: '#/dev/knowledgebase', title: 'Base de conocimiento' },
      { section: 'dev', route: '#/dev/tokens', title: 'Tokens de diseño' },
      { section: 'dev', route: '#/dev/components', title: 'Componentes' },
      { section: 'mockups', route: '#/docs/screenshots', title: 'Capturas' },
      { section: 'mockups', route: '#/dev/canvas', title: 'Canvas' },
      { section: 'mockups', route: '#/dev/simulator', title: 'Simulador' },
    ],
  },
  {
    slug: 'dorum-lifestyle', name: 'Llave OS', brand: '#0F3D2E', lang: 'en', industry: 'Real-estate agency',
    baseUrl: 'https://imagine-os.github.io/dorum-lifestyle/', roles: ['broker', 'owner', 'sales admin', 'tenant'],
    pages: [
      { section: 'hub', route: 'index.html', title: 'Landing' },
      { section: 'site', route: 'dorum/index.html', title: 'Brokerage website' },
      { section: 'site', route: 'index.html#pricing', title: 'Pricing' },
      { section: 'app', route: 'app/index.html?mode=phone', title: 'Tenant app', role: 'tenant', device: 'phone' },
      { section: 'staff', route: 'app/index.html#/role/broker/listings', title: 'Broker desk', role: 'broker' },
      { section: 'staff', route: 'index.html#roles', title: 'Roles' },
      { section: 'owner', route: 'app/index.html#/role/owner/reports', title: 'Owner reports', role: 'owner' },
      { section: 'docs', route: 'docs/index.html', title: 'Docs' },
      { section: 'plan', route: 'docs/plan.html', title: 'Product plan' },
      { section: 'dev', route: 'docs/conventions.html', title: 'Build conventions' },
      { section: 'mockups', route: 'mockups/index.html', title: 'Device gallery' },
    ],
  },
]);

const bySlug = new Map(CLIENTS.map((c) => [c.slug, c]));
export const clientBySlug = (slug) => bySlug.get(String(slug || '').trim()) || null;
export const CLIENT_SLUGS = Object.freeze(CLIENTS.map((c) => c.slug));

/** Brand colour for a client slug (a neutral accent when unknown). */
export const brandOf = (slug, fallback = '#5aa9ff') => clientBySlug(slug)?.brand || fallback;

/**
 * Full page descriptors of a client: audience / device from the section when not given, absolute
 * `url`, delivery `order` (template phase first, then the listed order), status `live`.
 */
export function pagesOf(client, { sections = null, status = 'live' } = {}) {
  const c = typeof client === 'string' ? clientBySlug(client) : client;
  if (!c) return [];
  const enabled = sections ? new Set(sections) : null;
  const list = c.pages.map((p, i) => ({ p, i, s: sectionById(p.section) })).filter(({ s, p }) => s && (!enabled || enabled.has(p.section)));
  list.sort((a, b) => (a.s.phase - b.s.phase) || (a.i - b.i));
  return list.map(({ p, s }, order) => ({
    url: joinUrl(c.baseUrl, p.route), route: p.route, title: p.title, section: s.id,
    audience: p.audience || s.audience, role: p.role || '', device: p.device || s.device,
    status, client: c.slug, order, lang: c.lang, brand: c.brand,
  }));
}

/** Blueprint params (what a hub-blueprint node holds) for a known client. */
export function blueprintParams(client) {
  const c = typeof client === 'string' ? clientBySlug(client) : client;
  if (!c) return null;
  return { client: c.name, slug: c.slug, brand: c.brand, lang: c.lang, baseUrl: c.baseUrl, industry: c.industry, roles: c.roles.join(', '), sections: SECTIONS.map((s) => s.id), status: 'live' };
}

/** Sections a client has at least one page in, in phase order. */
export const sectionsUsed = (client) => PHASES.filter((s) => (typeof client === 'string' ? clientBySlug(client) : client)?.pages.some((p) => p.section === s.id)).map((s) => s.id);
