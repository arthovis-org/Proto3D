// pm/panel-pm.js — the properties-panel editors for the project components. Each builder gets
// the panel's small API (DOM helpers bound to the panel + undoable writes) and the block; it
// reads `block.subSelection` to decide what to show (a card, a column, a task, or the whole
// board). Every write is a `setParam` command, so Ctrl+Z walks back card edits, moves, column
// changes and checklist toggles exactly like any other param change.
import {
  normalizeBoard, boardStats, addCard, moveCard, updateCard, removeCard, addColumn, updateColumn, removeColumn, moveColumn,
  findCard, allCards, PRIORITIES, PRIORITY_COLOURS, fmtDate, isOverdue, isBlocked, toTasks, createCard, isoDate, addDays,
} from './model.js';
import { commitBoard } from './board-ops.js';
import { connectedPeople, personTasks, groupByColumn, sameName } from './relations.js';

const boardOf = (b) => normalizeBoard(b.params.board);

/* ====================================================================================== */
/*  Kanban board: board editor · column editor · card editor                                */
/* ====================================================================================== */
export function buildBoardPanel(api, b) {
  const sel = b.subSelection;
  if (sel?.kind === 'card' && findCard(boardOf(b), sel.id)) buildCardEditor(api, b, sel.id);
  else if (sel?.kind === 'column' && boardOf(b).columns.some((c) => c.id === sel.id)) buildColumnEditor(api, b, sel.id);
  buildBoardEditor(api, b, sel);
}

function buildBoardEditor(api, b, sel) {
  const s = api.section('Board', !sel);
  api.readonly(s, 'cards', () => { const st = boardStats(boardOf(b)); return `${st.total} · ${Math.round(st.doneRatio * 100)} % done · ${st.overdue} overdue${st.blocked ? ` · ${st.blocked} blocked` : ''}`; });
  const list = api.h('ul', 'pm-list'); s.appendChild(list);
  const cols = boardOf(b).columns;
  cols.forEach((col, i) => {
    const li = api.h('li'); li.dataset.column = col.id; li.classList.toggle('on', sel?.kind === 'column' && sel.id === col.id);
    const main = api.h('div', 'pm-main'); main.appendChild(api.h('span', null, col.title)); main.appendChild(api.h('small', null, `${col.cards.length}${col.wipLimit ? ' / ' + col.wipLimit : ''}`)); li.appendChild(main);
    const btns = api.h('div', 'pm-btns');
    const mk = (t, title, fn, dis) => { const bt = api.h('button', null, t); bt.type = 'button'; bt.title = title; bt.disabled = !!dis; bt.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); btns.appendChild(bt); };
    mk('←', 'Move column left', () => { commitBoard(b, api.history, moveColumn(boardOf(b), col.id, -1), 'Reorder column'); api.rebuild(); }, i === 0);
    mk('→', 'Move column right', () => { commitBoard(b, api.history, moveColumn(boardOf(b), col.id, 1), 'Reorder column'); api.rebuild(); }, i === cols.length - 1);
    mk('✕', 'Remove column (cards move to the neighbour)', () => { commitBoard(b, api.history, removeColumn(boardOf(b), col.id), 'Remove column'); b.subSelection = null; api.rebuild(); }, cols.length <= 1);
    li.appendChild(btns);
    li.addEventListener('click', () => b.selectSub({ kind: 'column', id: col.id }, api.selection));
    list.appendChild(li);
  });
  const add = api.h('div', 'pm-inline');
  const inp = api.h('input'); inp.type = 'text'; inp.placeholder = 'New column title'; inp.id = 'pm-new-column';
  const go = api.h('button', null, 'Add column'); go.type = 'button';
  const doAdd = () => { const t = inp.value.trim() || 'Column'; const res = addColumn(boardOf(b), t); commitBoard(b, api.history, res, 'Add column'); b.selectSub({ kind: 'column', id: res.column.id }, api.selection); };
  go.addEventListener('click', doAdd); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  add.appendChild(inp); add.appendChild(go); s.appendChild(add);
  // all cards, grouped, clickable
  const c = api.section('Cards', !sel);
  const cl = api.h('ul', 'pm-list'); c.appendChild(cl);
  const board = boardOf(b);
  for (const { card, column } of allCards(board)) {
    const li = api.h('li'); li.dataset.card = card.id; li.classList.toggle('on', sel?.kind === 'card' && sel.id === card.id);
    const main = api.h('div', 'pm-main');
    const pr = api.h('i', 'pm-prio'); pr.style.background = PRIORITY_COLOURS[card.priority]; main.appendChild(pr);
    main.appendChild(api.h('span', null, card.title));
    main.appendChild(api.h('small', null, column.title + (isOverdue(card) && column !== board.columns[board.columns.length - 1] ? ' · overdue' : '') + (isBlocked(board, card) ? ' · blocked' : '')));
    li.appendChild(main);
    li.addEventListener('click', () => b.selectSub({ kind: 'card', id: card.id }, api.selection));
    cl.appendChild(li);
  }
  const addRow = api.h('div', 'pm-inline');
  const ci = api.h('input'); ci.type = 'text'; ci.placeholder = 'New card title'; ci.id = 'pm-new-card';
  const cgo = api.h('button', null, 'Add card'); cgo.type = 'button';
  const doCard = () => { const res = addCard(boardOf(b), boardOf(b).columns[0].id, { title: ci.value.trim() || 'New card' }); commitBoard(b, api.history, res, 'Add card'); b.selectSub({ kind: 'card', id: res.card.id }, api.selection); };
  cgo.addEventListener('click', doCard); ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCard(); });
  addRow.appendChild(ci); addRow.appendChild(cgo); c.appendChild(addRow);
}

function buildColumnEditor(api, b, id) {
  const col = () => boardOf(b).columns.find((c) => c.id === id);
  const s = api.section('Column');
  api.text(s, 'title', () => col()?.title || '', (v) => commitBoard(b, api.history, updateColumn(boardOf(b), id, { title: v }), 'Rename column'), 'columnTitle');
  api.num(s, 'WIP limit (0 = none)', () => col()?.wipLimit || 0, (v) => commitBoard(b, api.history, updateColumn(boardOf(b), id, { wipLimit: v }), 'WIP limit'), { step: 1, min: 0, max: 99, attr: 'wipLimit' });
  api.readonly(s, 'cards', () => { const c = col(); return c ? `${c.cards.length}${c.wipLimit && c.cards.length > c.wipLimit ? ' — over the WIP limit' : ''}` : '—'; });
  api.action(s, 'Add card here', () => { const res = addCard(boardOf(b), id, { title: 'New card' }); commitBoard(b, api.history, res, 'Add card'); b.selectSub({ kind: 'card', id: res.card.id }, api.selection); });
  api.action(s, 'Back to board', () => b.selectSub(null, api.selection));
}

function buildCardEditor(api, b, id) {
  const get = () => findCard(boardOf(b), id)?.card;
  const patch = (p, label, coalesce) => {
    const res = updateCard(boardOf(b), id, p); if (!res) return;
    if (coalesce) api.setParam('board', res.board, `card:${id}:${coalesce}`); else commitBoard(b, api.history, res, label || 'Edit card');
    b.faceDirty = true;
  };
  const s = api.section('Card');
  api.text(s, 'title', () => get()?.title || '', (v) => patch({ title: v }, 'Rename card', 'title'), 'cardTitle');
  api.area(s, 'description', () => get()?.description || '', (v) => patch({ description: v }, 'Describe card', 'description'), 'cardDescription', 3);
  // assignee: the people plugged into this board first, then every other Person, then free text
  const linked = connectedPeople(b).map((p) => String(p.params.name)).filter(Boolean);
  const persons = api.persons().map((p) => String(p.params.name)).filter((n) => n && !linked.some((l) => sameName(l, n)));
  const current = get()?.assignee || '';
  const opts = ['', ...new Set([...linked, ...persons, ...(current && ![...linked, ...persons].includes(current) ? [current] : [])])];
  api.select(s, 'assignee', opts, () => { const a = get()?.assignee || ''; return opts.includes(a) ? a : ''; }, (v) => patch({ assignee: v }, 'Assign card'), 'cardAssignee');
  api.text(s, 'assignee (free text)', () => get()?.assignee || '', (v) => patch({ assignee: v }, 'Assign card', 'assignee'), 'cardAssigneeText');
  api.date(s, 'due', () => get()?.due || '', (v) => patch({ due: v }, 'Set due date'), 'cardDue');
  api.select(s, 'priority', PRIORITIES, () => get()?.priority || 'medium', (v) => patch({ priority: v }, 'Set priority'), 'cardPriority');
  api.text(s, 'tags (comma)', () => (get()?.tags || []).join(', '), (v) => patch({ tags: v }, 'Tag card', 'tags'), 'cardTags');
  api.num(s, 'estimate (days)', () => get()?.estimate ?? 1, (v) => patch({ estimate: v }, 'Estimate card', 'estimate'), { step: 0.5, min: 0, max: 365, attr: 'cardEstimate' });
  const cols = boardOf(b).columns;
  const colOf = () => findCard(boardOf(b), id)?.column;
  api.select(s, 'column', cols.map((c) => c.title), () => colOf()?.title || '', (v) => {
    const to = cols.find((c) => c.title === v); if (!to || to.id === colOf()?.id) return;
    commitBoard(b, api.history, moveCard(boardOf(b), id, to.id), 'Move card'); api.rebuild();
  }, 'cardColumn');
  api.readonly(s, 'created', () => { const c = get(); return c ? `${fmtDate(c.createdAt)} · moved ${fmtDate(c.movedAt)}` : ''; });
  // cover: a generated image (Generate Image → board `cover`) or any media; shown as a thumbnail on the card
  const cvRow = api.row(s, 'cover'); const cvBox = api.h('div', 'cover-box'); cvRow.appendChild(cvBox);
  const renderCover = () => {
    const c = get()?.cover; const sig = c ? c.src : '';
    if (cvBox.dataset.sig === sig) return; cvBox.dataset.sig = sig; cvBox.innerHTML = '';
    if (!c) { cvBox.appendChild(api.h('span', 'pm-hint', 'none — plug a Generate Image or Media into the board\'s cover input')); return; }
    const img = api.h('img'); img.alt = c.title || 'cover'; img.src = c.src; cvBox.appendChild(img);
    const t = api.h('span', null, c.title || c.kind); cvBox.appendChild(t);
    const x = api.h('button', null, 'Remove'); x.type = 'button'; x.addEventListener('click', () => patch({ cover: null }, 'Remove cover')); cvBox.appendChild(x);
  };
  renderCover(); api.live(renderCover);

  // checklist
  const ck = api.section('Checklist');
  const list = api.h('ul', 'pm-list'); ck.appendChild(list);
  (get()?.checklist || []).forEach((item, i) => {
    const li = api.h('li'); li.dataset.item = String(i);
    const main = api.h('div', 'pm-main');
    const cb = api.h('input'); cb.type = 'checkbox'; cb.checked = !!item.done; cb.dataset.check = String(i);
    cb.addEventListener('change', () => { const c = get(); const cl = c.checklist.map((x, j) => (j === i ? { ...x, done: cb.checked } : x)); patch({ checklist: cl }, 'Toggle item'); });
    const tx = api.h('input'); tx.type = 'text'; tx.value = item.text;
    tx.addEventListener('input', () => { const c = get(); const cl = c.checklist.map((x, j) => (j === i ? { ...x, text: tx.value } : x)); patch({ checklist: cl }, 'Edit item', `item${i}`); });
    main.appendChild(cb); main.appendChild(tx); li.appendChild(main);
    const btns = api.h('div', 'pm-btns'); const rm = api.h('button', null, '✕'); rm.type = 'button'; rm.title = 'Remove item';
    rm.addEventListener('click', () => { const c = get(); patch({ checklist: c.checklist.filter((_, j) => j !== i) }, 'Remove item'); api.rebuild(); });
    btns.appendChild(rm); li.appendChild(btns); list.appendChild(li);
  });
  const addRow = api.h('div', 'pm-inline');
  const ni = api.h('input'); ni.type = 'text'; ni.placeholder = 'New checklist item'; ni.id = 'pm-new-item';
  const ngo = api.h('button', null, 'Add'); ngo.type = 'button';
  const doItem = () => { const t = ni.value.trim(); if (!t) return; const c = get(); patch({ checklist: [...c.checklist, { text: t, done: false }] }, 'Add item'); api.rebuild(); };
  ngo.addEventListener('click', doItem); ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') doItem(); });
  addRow.appendChild(ni); addRow.appendChild(ngo); ck.appendChild(addRow);

  // dependencies: blocked by (multi-select over the other cards)
  const dep = api.section('Blocked by', !!(get()?.blockedBy || []).length);
  const others = allCards(boardOf(b)).filter(({ card }) => card.id !== id);
  if (!others.length) dep.appendChild(api.h('div', 'pm-hint', 'no other cards'));
  const dl = api.h('ul', 'pm-list'); dep.appendChild(dl);
  for (const { card, column } of others) {
    const li = api.h('li'); const main = api.h('div', 'pm-main');
    const cb = api.h('input'); cb.type = 'checkbox'; cb.dataset.blocker = card.id; cb.checked = (get()?.blockedBy || []).includes(card.id);
    cb.addEventListener('change', () => { const c = get(); const set = new Set(c.blockedBy); if (cb.checked) set.add(card.id); else set.delete(card.id); patch({ blockedBy: [...set] }, 'Set dependency'); });
    main.appendChild(cb); main.appendChild(api.h('span', null, card.title)); main.appendChild(api.h('small', null, column.title));
    li.appendChild(main); li.addEventListener('click', (e) => { if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
    dl.appendChild(li);
  }
  const act = api.section('Card actions');
  api.action(act, 'Delete card', () => { commitBoard(b, api.history, removeCard(boardOf(b), id), 'Delete card'); b.selectSub(null, api.selection); }, 'pm-delete-card');
  api.action(act, 'Back to board', () => b.selectSub(null, api.selection));
}

/* ====================================================================================== */
/*  Person: the tasks assigned to them on every connected board (click → open the card)     */
/* ====================================================================================== */
export function buildPersonPanel(api, b) {
  const s = api.section('Tasks');
  const rows = personTasks(b);
  const boards = [...new Set(rows.map((r) => r.board))];
  api.readonly(s, 'boards', () => { const bs = [...new Set(personTasks(b).map((r) => r.board.title))]; return bs.length ? bs.join(', ') : 'none — plug person into a board\'s people slot'; });
  api.readonly(s, 'open', () => { const t = personTasks(b); return `${t.filter((r) => !r.done).length} of ${t.length} · capacity ${b.params.capacity}`; });
  const list = api.h('ul', 'pm-list pm-person-tasks'); s.appendChild(list);
  if (!rows.length) list.appendChild(api.h('li', 'pm-group', 'no tasks yet'));
  for (const gr of groupByColumn(rows)) {
    list.appendChild(api.h('li', 'pm-group', `${gr.column} · ${gr.rows.length}`));
    for (const r of gr.rows) {
      const li = api.h('li'); li.dataset.card = r.card.id; li.dataset.board = r.board.uid; li.title = `Open "${r.card.title}" on ${r.board.title}`;
      const main = api.h('div', 'pm-main');
      const pr = api.h('i', 'pm-prio'); pr.style.background = PRIORITY_COLOURS[r.card.priority]; main.appendChild(pr);
      main.appendChild(api.h('span', null, r.card.title));
      if (boards.length > 1) main.appendChild(api.h('small', null, r.board.title));
      const due = api.h('small', 'pm-due' + (r.overdue ? ' overdue' : ''), r.done ? 'done' : r.card.due ? (r.overdue ? '! ' : '') + fmtDate(r.card.due) : '');
      main.appendChild(due); li.appendChild(main);
      li.addEventListener('click', () => r.board.selectSub({ kind: 'card', id: r.card.id }, api.selection));
      list.appendChild(li);
    }
  }
}

/* ====================================================================================== */
/*  Timeline: own task list                                                                 */
/* ====================================================================================== */
export function buildTimelinePanel(api, b) {
  const tasks = () => (Array.isArray(b.params.tasks) ? b.params.tasks : []);
  const write = (list, label, coalesce) => (coalesce ? api.setParam('tasks', list, coalesce) : api.exec(Object.assign(cmdSet(api, b, 'tasks', list), { label })));
  const sel = b.subSelection;
  const own = sel?.kind === 'task' ? tasks().find((t) => t.id === sel.id) : null;
  if (sel?.kind === 'task' && !own) {
    const s = api.section('Task (from input)');
    const t = (b._rows || []).find((r) => r.id === sel.id);
    api.readonly(s, 'title', () => t?.title || sel.id);
    api.readonly(s, 'span', () => (t ? `${fmtDate(t.start)} → ${fmtDate(t.end)}` : '—'));
    api.readonly(s, 'assignee', () => t?.assignee || '—');
    api.readonly(s, 'source', () => 'fed through the tasks slot (edit it on the board)');
    api.action(s, 'Back to timeline', () => b.selectSub(null, api.selection));
  }
  if (own) {
    const id = own.id;
    const get = () => tasks().find((t) => t.id === id) || {};
    const patch = (p, label, coalesce) => write(tasks().map((t) => (t.id === id ? { ...t, ...p } : t)), label, coalesce ? `task:${id}:${coalesce}` : null);
    const s = api.section('Task');
    api.text(s, 'title', () => get().title || '', (v) => patch({ title: v }, 'Rename task', 'title'), 'taskTitle');
    api.date(s, 'start', () => get().start || '', (v) => patch({ start: v }, 'Task start'), 'taskStart');
    api.date(s, 'due', () => get().due || '', (v) => patch({ due: v }, 'Task due'), 'taskDue');
    api.text(s, 'assignee', () => get().assignee || '', (v) => patch({ assignee: v }, 'Assign task', 'assignee'), 'taskAssignee');
    api.select(s, 'priority', PRIORITIES, () => get().priority || 'medium', (v) => patch({ priority: v }, 'Task priority'), 'taskPriority');
    api.check(s, 'done', () => !!get().done, (v) => patch({ done: v }, 'Task done'), 'taskDone');
    api.action(s, 'Delete task', () => { write(tasks().filter((t) => t.id !== id), 'Delete task'); b.selectSub(null, api.selection); });
    api.action(s, 'Back to timeline', () => b.selectSub(null, api.selection));
  }
  const s = api.section('Tasks', !sel);
  const list = api.h('ul', 'pm-list'); s.appendChild(list);
  for (const t of tasks()) {
    const li = api.h('li'); li.dataset.task = t.id; li.classList.toggle('on', sel?.kind === 'task' && sel.id === t.id);
    const main = api.h('div', 'pm-main'); const pr = api.h('i', 'pm-prio'); pr.style.background = PRIORITY_COLOURS[t.priority || 'medium']; main.appendChild(pr);
    main.appendChild(api.h('span', null, t.title)); main.appendChild(api.h('small', null, `${fmtDate(t.start)} → ${fmtDate(t.due)}`));
    li.appendChild(main); li.addEventListener('click', () => b.selectSub({ kind: 'task', id: t.id }, api.selection));
    list.appendChild(li);
  }
  const addRow = api.h('div', 'pm-inline');
  const ni = api.h('input'); ni.type = 'text'; ni.placeholder = 'New task (starts today, 3 days)'; ni.id = 'pm-new-task';
  const go = api.h('button', null, 'Add'); go.type = 'button';
  const doAdd = () => { const t = ni.value.trim() || 'Task'; const today = isoDate(); const task = { id: createCard({}).id.replace(/^c/, 't'), title: t, start: today, due: addDays(today, 3), assignee: '', priority: 'medium', done: false }; write([...tasks(), task], 'Add task'); b.selectSub({ kind: 'task', id: task.id }, api.selection); };
  go.addEventListener('click', doAdd); ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  addRow.appendChild(ni); addRow.appendChild(go); s.appendChild(addRow);
  api.readonly(s, 'rows shown', () => String((b._rows || []).length));
}
// a plain setParam command (the api's exec expects a command object)
function cmdSet(api, b, key, value) {
  const prev = JSON.parse(JSON.stringify(b.params[key] ?? null));
  const next = JSON.parse(JSON.stringify(value));
  return {
    label: `Set ${key}`,
    do: () => { b.params[key] = JSON.parse(JSON.stringify(next)); b.faceDirty = true; api.world.changed('param'); },
    undo: () => { b.params[key] = JSON.parse(JSON.stringify(prev)); b.faceDirty = true; api.world.changed('param'); },
  };
}

/* ====================================================================================== */
/*  Checklist component                                                                     */
/* ====================================================================================== */
export function buildChecklistPanel(api, b) {
  const items = () => (Array.isArray(b.params.items) ? b.params.items : []);
  const write = (list, label, coalesce) => { if (coalesce) api.setParam('items', list, coalesce); else api.exec(Object.assign(cmdSet(api, b, 'items', list), { label })); };
  const s = api.section('Items');
  const list = api.h('ul', 'pm-list'); s.appendChild(list);
  items().forEach((item, i) => {
    const li = api.h('li'); li.dataset.item = String(i);
    const main = api.h('div', 'pm-main');
    const cb = api.h('input'); cb.type = 'checkbox'; cb.checked = !!item.done; cb.dataset.check = String(i);
    cb.addEventListener('change', () => write(items().map((x, j) => (j === i ? { ...x, done: cb.checked } : x)), 'Toggle item'));
    const tx = api.h('input'); tx.type = 'text'; tx.value = item.text || '';
    tx.addEventListener('input', () => write(items().map((x, j) => (j === i ? { ...x, text: tx.value } : x)), 'Edit item', `item${i}`));
    main.appendChild(cb); main.appendChild(tx); li.appendChild(main);
    const btns = api.h('div', 'pm-btns');
    const up = api.h('button', null, '↑'); up.type = 'button'; up.disabled = i === 0; up.addEventListener('click', () => { const l = items().slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; write(l, 'Reorder item'); api.rebuild(); });
    const rm = api.h('button', null, '✕'); rm.type = 'button'; rm.addEventListener('click', () => { write(items().filter((_, j) => j !== i), 'Remove item'); api.rebuild(); });
    btns.appendChild(up); btns.appendChild(rm); li.appendChild(btns);
    list.appendChild(li);
  });
  const addRow = api.h('div', 'pm-inline');
  const ni = api.h('input'); ni.type = 'text'; ni.placeholder = 'New item'; ni.id = 'pm-new-check';
  const go = api.h('button', null, 'Add'); go.type = 'button';
  const doAdd = () => { const t = ni.value.trim(); if (!t) return; write([...items(), { text: t, done: false }], 'Add item'); api.rebuild(); };
  go.addEventListener('click', doAdd); ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  addRow.appendChild(ni); addRow.appendChild(go); s.appendChild(addRow);
  api.action(s, 'Reset all to not done', () => write(items().map((x) => ({ ...x, done: false })), 'Reset checklist'));
}
