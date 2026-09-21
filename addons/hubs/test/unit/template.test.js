// Template and client data integrity: unique section ids, every client page names a known
// section, urls resolve under the client's base, descriptors carry audience / device / order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, SECTION_IDS, AUDIENCES, DEVICES, PHASES, sectionById, synthesizePages, joinUrl } from '../../src/template.js';
import { CLIENTS, pagesOf, blueprintParams, clientBySlug, sectionsUsed, pageId, previewPath, previewFor } from '../../src/clients.js';

test('template: eleven sections with unique ids, known audiences / devices, phases 0..10 in order', () => {
  assert.equal(SECTIONS.length, 11);
  assert.equal(new Set(SECTION_IDS).size, SECTION_IDS.length);
  for (const s of SECTIONS) { assert.ok(AUDIENCES.includes(s.audience), s.id); assert.ok(DEVICES.includes(s.device), s.id); assert.ok(s.description.length > 20, s.id); }
  assert.deepEqual(PHASES.map((s) => s.phase), [...Array(11).keys()]);
  assert.equal(sectionById('machine').audience, 'machine'); assert.equal(sectionById('nope'), null);
});

test('clients: five hubs, unique slugs, every page references a known section, phone pages are apps, urls sit under the base', () => {
  assert.deepEqual(CLIENTS.map((c) => c.slug), ['cal-tenant-law', 'petrock', 'hoy', 'dorum-lifestyle', 'aluzina']);
  assert.deepEqual(CLIENTS.map((c) => c.pages.length), [21, 15, 18, 11, 24]);
  assert.equal(pagesOf('aluzina').find((p) => p.section === 'app').url, 'https://imagine-os.github.io/aluzina/?as=client#/client');
  assert.equal(pageId('?as=client#/client'), 'as-client-client'); assert.equal(pageId('business-os/'), 'business-os');
  for (const c of CLIENTS) {
    assert.match(c.brand, /^#[0-9A-Fa-f]{6}$/); assert.ok(['en', 'es'].includes(c.lang)); assert.match(c.baseUrl, /^https:\/\/imagine-os\.github\.io\/[a-z-]+\/$/);
    for (const p of c.pages) assert.ok(sectionById(p.section), `${c.slug}: ${p.route} → unknown section ${p.section}`);
    const pages = pagesOf(c);
    assert.equal(pages.length, c.pages.length);
    assert.deepEqual(pages.map((p) => p.order), [...Array(pages.length).keys()], 'order is 0..n-1 in delivery order');
    for (let i = 1; i < pages.length; i++) assert.ok(sectionById(pages[i - 1].section).phase <= sectionById(pages[i].section).phase, `${c.slug}: phase order`);
    for (const p of pages) {
      assert.ok(p.url.startsWith(c.baseUrl), `${c.slug}: ${p.url}`); assert.ok(AUDIENCES.includes(p.audience)); assert.ok(DEVICES.includes(p.device));
      assert.equal(p.status, 'live'); assert.equal(p.client, c.slug); assert.equal(p.lang, c.lang);
    }
    assert.ok(pages.filter((p) => p.section === 'app').every((p) => p.device === 'phone'), `${c.slug}: the customer app is a phone page`);
    assert.equal(pages.filter((p) => p.section === 'hub').length, 1, `${c.slug}: exactly one hub page`);
  }
  assert.equal(pagesOf('hoy').find((p) => p.route === '#/teach').device, 'tablet');
  assert.equal(pagesOf('dorum-lifestyle').find((p) => p.section === 'app').url, 'https://imagine-os.github.io/dorum-lifestyle/app/index.html?mode=phone');
  assert.deepEqual(pagesOf('nope'), []);
  assert.deepEqual(sectionsUsed('petrock'), ['hub', 'site', 'app', 'staff', 'owner', 'manual', 'docs', 'dev', 'mockups']);
});

test('pagesOf filters by enabled sections; blueprintParams mirrors the client', () => {
  const only = pagesOf('cal-tenant-law', { sections: ['app', 'machine'] });
  assert.deepEqual(only.map((p) => [p.section, p.route]), [['app', '#/app'], ['machine', '#/dev/actions']]);
  const bp = blueprintParams('petrock');
  assert.equal(bp.client, 'Petrock'); assert.equal(bp.slug, 'petrock'); assert.equal(bp.baseUrl, clientBySlug('petrock').baseUrl); assert.deepEqual(bp.sections, SECTION_IDS); assert.equal(bp.status, 'live');
  assert.equal(blueprintParams('nope'), null);
});

test('synthesizePages: template defaults for an unknown client, planned, under the base url; joinUrl handles hashes and files', () => {
  const pages = synthesizePages({ baseUrl: 'https://example.test/acme', slug: 'acme' });
  assert.equal(pages.length, 13);
  assert.equal(pages[0].url, 'https://example.test/acme/#/'); assert.equal(pages[0].section, 'hub');
  assert.ok(pages.every((p) => p.status === 'planned' && p.client === 'acme' && sectionById(p.section)));
  assert.equal(synthesizePages({ baseUrl: 'x/', sections: ['app'] }).length, 1);
  assert.equal(joinUrl('https://a.b/c/', 'docs/plan.html'), 'https://a.b/c/docs/plan.html');
  assert.equal(joinUrl('https://a.b/c', '#/x'), 'https://a.b/c/#/x');
  assert.equal(joinUrl('', '#/x'), '#/x');
});

test('previews: page ids are file-safe and unique per client, preview paths derive from slug + route, previewFor reads the param or derives it', () => {
  assert.equal(pageId('#/'), 'index'); assert.equal(pageId('index.html'), 'index'); assert.equal(pageId('#/site/proposal'), 'site-proposal');
  assert.equal(pageId('app/index.html?mode=phone'), 'app-mode-phone'); assert.equal(pageId('app/index.html#/role/broker/listings'), 'app-role-broker-listings'); assert.equal(pageId('index.html#roles'), 'roles');
  assert.equal(pageId('https://imagine-os.github.io/petrock/#/dev/qa/screenshots'), 'dev-qa-screenshots', 'a full url reduces to its route');
  for (const c of CLIENTS) { const ids = c.pages.map((p) => pageId(p.route)); assert.equal(new Set(ids).size, ids.length, `${c.slug}: page ids unique`); assert.ok(ids.every((id) => /^[a-z0-9-]+$/.test(id)), `${c.slug}: file-safe ids`); }
  assert.equal(previewPath('petrock', '#/app'), 'assets/previews/petrock/app.jpg');
  assert.ok(pagesOf('hoy').every((p) => p.preview === previewPath('hoy', p.route)));
  assert.equal(previewFor({ preview: 'x/y.jpg' }), 'x/y.jpg');
  assert.equal(previewFor({ client: 'cal-tenant-law', url: 'https://imagine-os.github.io/cal-tenant-law/#/desk' }), 'assets/previews/cal-tenant-law/desk.jpg');
  assert.equal(previewFor({ client: 'cal-tenant-law', url: 'https://elsewhere.test/' }), ''); assert.equal(previewFor({ client: 'nope', url: 'x' }), '');
});
