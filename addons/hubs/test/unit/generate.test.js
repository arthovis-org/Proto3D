// Descriptor builder and tasks: a known slug takes the real route list, an unknown slug the
// template defaults (planned); tasks match the core PM card shape; regeneration keeps statuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesFor, tasksFor, boardFor, planGeneration, blueprintSlug, statusColumn, pageParams } from '../../src/generate.js';
import { blueprintParams } from '../../src/clients.js';
import { SECTION_IDS } from '../../src/template.js';

test('pagesFor: known slug → real routes (21 for CTL), live, brand / lang from the client; sections filter applies', () => {
  const pages = pagesFor(blueprintParams('cal-tenant-law'));
  assert.equal(pages.length, 21);
  assert.equal(pages[0].url, 'https://imagine-os.github.io/cal-tenant-law/#/');
  assert.ok(pages.every((p) => p.status === 'live' && p.brand === '#1F4E79' && p.lang === 'en' && p.client === 'cal-tenant-law'));
  assert.equal(pagesFor({ ...blueprintParams('cal-tenant-law'), sections: ['dev'] }).length, 4);
  assert.equal(pagesFor({ slug: 'hoy', sections: 'app, staff' }).length, 4, 'sections may be a comma string');
  // a custom base url overrides the client's
  assert.ok(pagesFor({ slug: 'petrock', baseUrl: 'https://mirror.test/petrock/' }).every((p) => p.url.startsWith('https://mirror.test/petrock/')));
});

test('pagesFor: unknown slug → template defaults, planned, from the client name when slug is empty', () => {
  const pages = pagesFor({ client: 'Acme Dental', baseUrl: 'https://imagine-os.github.io/acme/' });
  assert.equal(blueprintSlug({ client: 'Acme Dental' }), 'acme-dental');
  assert.equal(pages.length, 13);
  assert.ok(pages.every((p) => p.status === 'planned' && p.client === 'acme-dental' && p.url.startsWith('https://imagine-os.github.io/acme/#/')));
  assert.equal(pagesFor({ client: 'Acme', status: 'building' })[0].status, 'building');
  assert.equal(pageParams(pages[0]).live, true);
});

test('tasksFor: one task per enabled section in the PM card shape, column from status, checklist of pages, fixed dates', () => {
  const params = blueprintParams('petrock');
  const tasks = tasksFor(params, pagesFor(params), { today: '2026-09-21' });
  assert.equal(tasks.length, SECTION_IDS.length);
  const t = tasks.find((x) => x.section === 'site');
  assert.equal(t.title, 'Public website for Petrock');
  assert.deepEqual(Object.keys(t).sort(), ['assignee', 'blockedBy', 'checklist', 'client', 'column', 'createdAt', 'description', 'done', 'due', 'estimate', 'id', 'movedAt', 'pages', 'priority', 'section', 'start', 'tags', 'title']);
  assert.deepEqual(t.checklist, [{ text: 'Public website', done: true }, { text: 'Pricing', done: true }]);
  assert.equal(t.start, '2026-09-24'); assert.equal(t.due, '2026-09-28'); assert.equal(t.column, 'Done'); assert.equal(t.done, true); assert.equal(t.estimate, 2);
  assert.ok(tasks.every((x) => x.id.startsWith('hub-petrock-') && Array.isArray(x.tags) && x.tags.includes('petrock')));
  const planned = tasksFor({ client: 'Acme', sections: ['hub', 'app'] }, undefined, { today: '2026-01-01' });
  assert.deepEqual(planned.map((x) => [x.title, x.column, x.done]), [['Testing hub for Acme', 'To do', false], ['Customer app for Acme', 'To do', false]]);
  assert.equal(statusColumn('building'), 'In progress');
  const board = boardFor(tasks);
  assert.deepEqual(board.columns.map((c) => [c.title, c.cards.length]), [['To do', 0], ['In progress', 0], ['Review', 0], ['Done', 11]]);
  assert.ok(!('column' in board.columns[3].cards[0]) && 'checklist' in board.columns[3].cards[0]);
});

test('planGeneration: first run creates everything; a rerun removes the old pages and keeps a user-edited status', () => {
  const params = blueprintParams('hoy');
  const first = planGeneration(params, []);
  assert.equal(first.create.length, 18); assert.equal(first.remove.length, 0); assert.equal(first.regenerate, false);
  const existing = first.create.map((d, i) => ({ typeId: 'hub-page', uid: `n${i}`, params: { ...pageParams(d), status: d.section === 'app' ? 'building' : d.status } }));
  existing.push({ typeId: 'hub-page', uid: 'other', params: { client: 'petrock', url: 'x' } });
  const again = planGeneration(params, existing);
  assert.equal(again.regenerate, true); assert.equal(again.remove.length, 18); assert.ok(!again.remove.some((n) => n.uid === 'other'), 'other clients untouched');
  const app = again.create.find((d) => d.section === 'app');
  assert.equal(app.status, 'building'); assert.equal(app.preserved, true);
  assert.ok(again.create.filter((d) => d.section !== 'app').every((d) => d.status === 'live' && !d.preserved));
});
