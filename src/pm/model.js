// pm/model.js — the project-management data model: plain, serializable objects that live in
// component params / state and travel through the world JSON. No Three.js here: the Kanban
// board, the Timeline, the Dashboard and the Person component all read and write through these
// helpers, so the same card is a slab on a board, a bar on a Gantt and a count on a dashboard.
//
//   Card      { id, title, description, assignee, due, priority, tags[], checklist[{text,done}],
//               estimate, createdAt, movedAt, blockedBy[], cover? { kind, src, title, storeId?, hosted? } }
//   Column    { id, title, wipLimit?, cards: [Card] }
//   Board     { columns: [Column] }
//   Person    { id, name, role, colour, capacity }
//   Milestone { title, date }

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const PRIORITY_COLOURS = { low: '#6f8bb0', medium: '#2dd4bf', high: '#f5b942', urgent: '#ff4d5e' };
export const DAY_MS = 86400000;

let seq = 0;
export const newId = (prefix = 'c') => `${prefix}${Date.now().toString(36).slice(-4)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** ISO date (yyyy-mm-dd) for a Date / timestamp / ISO string; '' when invalid. */
export function isoDate(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : '';
}
/** Days from today to an ISO date (negative = past). NaN when there is no date. */
export function daysUntil(iso, today = new Date()) {
  if (!iso) return NaN;
  const a = new Date(isoDate(today) + 'T00:00:00Z').getTime(), b = new Date(String(iso).slice(0, 10) + 'T00:00:00Z').getTime();
  return Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : NaN;
}
export const addDays = (iso, n) => isoDate(new Date(new Date(String(iso).slice(0, 10) + 'T00:00:00Z').getTime() + n * DAY_MS));
export const isOverdue = (card, today = new Date()) => !!card.due && daysUntil(card.due, today) < 0;

/* ---------------- factories ---------------- */
export function createCard(o = {}) {
  const now = new Date().toISOString();
  return {
    id: o.id || newId('c'),
    title: String(o.title ?? 'New card'),
    description: String(o.description ?? ''),
    assignee: o.assignee ? String(o.assignee) : '',
    due: o.due ? String(o.due).slice(0, 10) : '',
    priority: PRIORITIES.includes(o.priority) ? o.priority : 'medium',
    tags: Array.isArray(o.tags) ? o.tags.map(String) : typeof o.tags === 'string' ? o.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
    checklist: Array.isArray(o.checklist) ? o.checklist.map((i) => (typeof i === 'string' ? { text: i, done: false } : { text: String(i.text ?? ''), done: !!i.done })) : [],
    estimate: Number.isFinite(+o.estimate) ? +o.estimate : 1,
    createdAt: o.createdAt || now,
    movedAt: o.movedAt || now,
    blockedBy: Array.isArray(o.blockedBy) ? o.blockedBy.map(String) : [],
    ...(o.cover && typeof o.cover === 'object' && typeof o.cover.src === 'string' ? { cover: coverRecord(o.cover) } : {}),
  };
}
/** The part of a media object a card keeps as its cover (a reference, never the pixels). */
export const coverRecord = (m) => ({ kind: m.kind || 'image', src: m.src, title: m.title || '', ...(m.storeId ? { storeId: m.storeId } : {}), ...(m.hosted ? { hosted: m.hosted } : {}), ...(m.w ? { w: m.w, h: m.h } : {}) });
export function createColumn(o = {}) {
  return { id: o.id || newId('k'), title: String(o.title ?? 'Column'), wipLimit: Number.isFinite(+o.wipLimit) && +o.wipLimit > 0 ? +o.wipLimit : 0, cards: (o.cards || []).map(createCard) };
}
export function createBoard(o = {}) {
  const cols = o.columns && o.columns.length ? o.columns : ['To do', 'In progress', 'Review', 'Done'].map((title) => ({ title }));
  return { columns: cols.map(createColumn) };
}
export function createPerson(o = {}) {
  return { id: o.id || newId('p'), name: String(o.name ?? 'Someone'), role: String(o.role ?? ''), colour: o.colour || '#5aa9ff', capacity: Number.isFinite(+o.capacity) ? +o.capacity : 5 };
}
export const createMilestone = (o = {}) => ({ title: String(o.title ?? 'Milestone'), date: o.date ? String(o.date).slice(0, 10) : isoDate(new Date(Date.now() + 14 * DAY_MS)) });

/** Normalise anything that claims to be a board (a saved param, a JSON payload). Never throws. */
export function normalizeBoard(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.columns) || !b.columns.length) return createBoard();
  return { columns: b.columns.map(createColumn) };
}
export const cloneBoard = (b) => JSON.parse(JSON.stringify(b));

/* ---------------- queries ---------------- */
export const allCards = (board) => board.columns.flatMap((col) => col.cards.map((c) => ({ card: c, column: col })));
export function findCard(board, idOrTitle) {
  const q = String(idOrTitle ?? '').trim().toLowerCase();
  for (const col of board.columns) {
    const i = col.cards.findIndex((c) => c.id === idOrTitle || c.title.toLowerCase() === q);
    if (i >= 0) return { card: col.cards[i], column: col, index: i };
  }
  return null;
}
export function findColumn(board, idOrTitle) {
  const q = String(idOrTitle ?? '').trim().toLowerCase();
  return board.columns.find((c) => c.id === idOrTitle) || board.columns.find((c) => c.title.toLowerCase() === q) || null;
}
export const lastColumn = (board) => board.columns[board.columns.length - 1];
export const isDone = (board, card) => !!lastColumn(board) && lastColumn(board).cards.some((c) => c.id === card.id);
/** A card is blocked while any card it depends on is not in the last (done) column. */
export function isBlocked(board, card) {
  if (!card.blockedBy || !card.blockedBy.length) return false;
  const done = new Set(lastColumn(board).cards.map((c) => c.id));
  return card.blockedBy.some((id) => !done.has(id) && findCard(board, id));
}
export const initials = (name) => String(name || '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
export const checklistRatio = (card) => (card.checklist && card.checklist.length ? card.checklist.filter((i) => i.done).length / card.checklist.length : NaN);

/* ---------------- mutations (pure: return a new board) ---------------- */
export function addCard(board, columnIdOrTitle, cardData, index = -1) {
  const b = cloneBoard(board);
  const col = findColumn(b, columnIdOrTitle) || b.columns[0];
  const card = createCard(typeof cardData === 'string' ? { title: cardData } : cardData || {});
  if (index < 0 || index > col.cards.length) col.cards.push(card); else col.cards.splice(index, 0, card);
  return { board: b, card, column: col };
}
/** Move a card to a column (and optional index). Returns the new board plus { card, from, to }. */
export function moveCard(board, cardIdOrTitle, columnIdOrTitle, index = -1) {
  const b = cloneBoard(board);
  const hit = findCard(b, cardIdOrTitle);
  const to = findColumn(b, columnIdOrTitle);
  if (!hit || !to) return null;
  const from = hit.column;
  from.cards.splice(hit.index, 1);
  let at = index < 0 || index > to.cards.length ? to.cards.length : index;
  if (from === to && hit.index < index) at = Math.max(0, at - 1);
  const card = { ...hit.card, movedAt: new Date().toISOString() };
  to.cards.splice(at, 0, card);
  return { board: b, card, from, to, index: at, changed: from !== to || at !== hit.index };
}
export function updateCard(board, cardId, patch) {
  const b = cloneBoard(board);
  const hit = findCard(b, cardId);
  if (!hit) return null;
  const next = createCard({ ...hit.card, ...patch, id: hit.card.id });
  hit.column.cards[hit.index] = next;
  return { board: b, card: next, column: hit.column };
}
export function removeCard(board, cardId) {
  const b = cloneBoard(board);
  const hit = findCard(b, cardId);
  if (!hit) return null;
  hit.column.cards.splice(hit.index, 1);
  for (const { card } of allCards(b)) card.blockedBy = card.blockedBy.filter((id) => id !== cardId);
  return { board: b, card: hit.card };
}
export function addColumn(board, title = 'Column', index = -1) {
  const b = cloneBoard(board);
  const col = createColumn({ title });
  if (index < 0 || index > b.columns.length) b.columns.push(col); else b.columns.splice(index, 0, col);
  return { board: b, column: col };
}
export function updateColumn(board, columnId, patch) {
  const b = cloneBoard(board);
  const col = findColumn(b, columnId);
  if (!col) return null;
  if (patch.title !== undefined) col.title = String(patch.title);
  if (patch.wipLimit !== undefined) col.wipLimit = Math.max(0, Math.round(+patch.wipLimit || 0));
  return { board: b, column: col };
}
/** Remove a column; its cards go to the neighbour (previous, else next). The last column cannot go. */
export function removeColumn(board, columnId) {
  const b = cloneBoard(board);
  const i = b.columns.findIndex((c) => c.id === columnId);
  if (i < 0 || b.columns.length <= 1) return null;
  const [col] = b.columns.splice(i, 1);
  const target = b.columns[Math.max(0, i - 1)];
  target.cards.push(...col.cards);
  return { board: b, column: col };
}
export function moveColumn(board, columnId, delta) {
  const b = cloneBoard(board);
  const i = b.columns.findIndex((c) => c.id === columnId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= b.columns.length) return null;
  const [col] = b.columns.splice(i, 1);
  b.columns.splice(j, 0, col);
  return { board: b, column: col };
}

/* ---------------- computed ---------------- */
/** Counts per column, done ratio, overdue count, WIP breaches. */
export function boardStats(board, today = new Date()) {
  const columns = board.columns.map((c) => ({ id: c.id, title: c.title, count: c.cards.length, wipLimit: c.wipLimit || 0, overWip: !!(c.wipLimit && c.cards.length > c.wipLimit) }));
  const total = columns.reduce((a, c) => a + c.count, 0);
  const last = lastColumn(board);
  const done = last ? last.cards.length : 0;
  const overdue = board.columns.filter((c) => c !== last).reduce((a, c) => a + c.cards.filter((k) => isOverdue(k, today)).length, 0);
  const blocked = allCards(board).filter(({ card }) => isBlocked(board, card)).length;
  const estimate = allCards(board).reduce((a, { card }) => a + (card.estimate || 0), 0);
  const remaining = allCards(board).filter(({ column }) => column !== last).reduce((a, { card }) => a + (card.estimate || 0), 0);
  return { columns, total, done, doneRatio: total ? +(done / total).toFixed(3) : 0, overdue, blocked, estimate, remaining };
}
/** Flat list of cards with their column (what the `cards` output carries). */
export function flatCards(board) {
  return board.columns.flatMap((col, ci) => col.cards.map((c, i) => ({ ...c, column: col.title, columnId: col.id, columnIndex: ci, order: i, done: ci === board.columns.length - 1, blocked: isBlocked(board, c) })));
}
/**
 * Burndown: a series of { t, remaining } points. `history` is kept in component state and gets
 * a new point whenever the remaining work changes (moves into / out of Done, adds, removes).
 */
export function pushBurndown(history, stats, max = 80) {
  const h = Array.isArray(history) ? history : [];
  const last = h[h.length - 1];
  const remaining = +stats.remaining.toFixed(2), total = +stats.estimate.toFixed(2);
  if (last && last.remaining === remaining && last.total === total && last.cards === stats.total) return h;
  h.push({ t: new Date().toISOString(), remaining, total, cards: stats.total, done: stats.done });
  while (h.length > max) h.shift();
  return h;
}
/** Convert cards / tasks into timeline rows { id, title, start, end, assignee, priority, column, done }. */
export function toTasks(items, today = new Date()) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const est = Math.max(0.5, Number.isFinite(+it.estimate) ? +it.estimate : 1);
    let end = it.due || it.end ? String(it.due || it.end).slice(0, 10) : '';
    let start = it.start ? String(it.start).slice(0, 10) : '';
    if (!start && !end) continue;
    if (!start) start = addDays(end, -Math.ceil(est));
    if (!end) end = addDays(start, Math.ceil(est));
    if (daysUntil(end) < daysUntil(start)) [start, end] = [end, start];
    out.push({ id: it.id || newId('t'), title: String(it.title ?? 'task'), start, end, assignee: it.assignee || '', priority: it.priority || 'medium', column: it.column || '', done: !!it.done, overdue: !it.done && daysUntil(end, today) < 0, estimate: est });
  }
  return out;
}
export const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : String(iso); };
