// pm/relations.js — what a cable between two project components *means*. The engine already
// delivers values; this module reads the graph as relationships so components can act on who
// they are plugged into (a Person lists the tasks of every board it feeds, a board lays out the
// people connected to it) and so the UI can say it in a sentence ("Maya's tasks appear on
// Website relaunch"). No Three.js: everything works from `world.connections` and params.
import { normalizeBoard, isOverdue, isBlocked, lastColumn } from './model.js';

export const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const boardOf = (node) => normalizeBoard(node.params?.board);

/** Person nodes plugged into a board's `people` slot, in cable order (the slot order). */
export function connectedPeople(boardNode) {
  const port = boardNode.getPort?.('people', 'in');
  const world = boardNode.world;
  if (!port || !world) return [];
  return world.connections.filter((c) => c.to === port && c.from.owner.typeId === 'person' && c.valid !== false).map((c) => c.from.owner);
}
/** The Person node (if any) whose name matches an assignee, preferring the people connected to `boardNode`. */
export function personFor(boardNode, name) {
  if (!name) return null;
  const linked = connectedPeople(boardNode).find((p) => sameName(p.params.name, name));
  if (linked) return linked;
  return boardNode.world?.nodes.find((n) => n.typeId === 'person' && sameName(n.params.name, name)) || null;
}

/**
 * Boards a Person is related to: the boards its `person` output feeds (their `people` slot) and
 * the boards whose `tasks` output feeds its `tasks` input. Deduplicated, in cable order.
 */
export function personBoards(personNode) {
  const world = personNode.world;
  if (!world) return [];
  const out = [];
  const add = (n) => { if (n && n.typeId === 'kanban-board' && !out.includes(n)) out.push(n); };
  const me = personNode.getPort?.('person', 'out'), tasks = personNode.getPort?.('tasks', 'in');
  for (const c of world.connections) {
    if (c.valid === false || !c.to) continue;
    if (me && c.from === me && c.to.key === 'people') add(c.to.owner);
    if (tasks && c.to === tasks && c.from.key === 'tasks') add(c.from.owner);
  }
  return out;
}
/**
 * Every card assigned to a Person on every board it is related to:
 * `[{ card, column, columnIndex, board, done, overdue, blocked }]` in board / column / card order.
 */
export function personTasks(personNode) {
  const name = personNode.params?.name;
  const rows = [];
  for (const board of personBoards(personNode)) {
    const b = boardOf(board); const last = lastColumn(b);
    b.columns.forEach((column, columnIndex) => {
      for (const card of column.cards) {
        if (!sameName(card.assignee, name)) continue;
        const done = column === last;
        rows.push({ card, column, columnIndex, board, done, overdue: !done && isOverdue(card), blocked: isBlocked(b, card) });
      }
    });
  }
  return rows;
}
/** Group task rows by column title (board order kept): `[{ column, rows }]`. */
export function groupByColumn(rows) {
  const groups = [];
  for (const r of rows) {
    const key = r.column.title;
    let g = groups.find((x) => x.column === key);
    if (!g) { g = { column: key, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  return groups;
}

/* ---------------- sentences ---------------- */
const poss = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
/**
 * Sentence for a link between two components, or null when there is nothing better than the
 * "from → to · type" text. A definition may provide `describeLink(fromPort, toDef, toPort, names)`
 * for its own outputs; otherwise the table below covers the project relationships.
 */
export function describeLink(conn) {
  if (!conn || !conn.from || !conn.to) return null;
  return describePorts(conn.from, conn.to);
}
export function describePorts(from, to) {
  const A = from.owner, B = to.owner;
  if (!A || !B || A.kind === 'group' || B.kind === 'group') return null;
  const names = { from: A.title, to: B.title, fromPoss: poss(A.title), toPoss: poss(B.title) };
  const own = A.def?.describeLink?.(from, B.def, to, names);
  if (own) return own;
  const key = `${A.typeId}.${from.key}>${B.typeId}.${to.key}`;
  const T = TABLE[key] || TABLE[`${A.typeId}.${from.key}>*`] || TABLE[`*>${B.typeId}.${to.key}`];
  if (T) return T(names, from, to);
  if (from.type === 'event' && /^when /.test(from.label)) return `${cap(from.label)} on ${names.from}, ${names.to} ${to.type === 'event' ? verbFor(to) : 'reacts'}`;
  return null;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const verbFor = (to) => ({ start: 'starts', trigger: 'fires', in: 'runs' }[to.key] || `gets ${to.label}`);
const TABLE = {
  'person.person>kanban-board.people': (n) => `${n.fromPoss} tasks appear on ${n.to}`,
  'person.person>project-dashboard.people': (n) => `${n.fromPoss} load shows on ${n.to}`,
  'person.person>*': (n, f, t) => `${n.fromPoss} details go to ${n.to}`,
  'person.summary>*': (n) => `${n.fromPoss} task list shows on ${n.to}`,
  'person.load>*': (n) => `${n.fromPoss} load feeds ${n.to}`,
  'kanban-board.tasks>timeline.tasks': (n) => `${n.fromPoss} tasks fill the ${n.to}`,
  'kanban-board.tasks>person.tasks': (n) => `${n.to} takes their tasks from ${n.from}`,
  'kanban-board.tasks>project-dashboard.tasks': (n) => `${n.fromPoss} tasks feed ${n.to}`,
  'kanban-board.tasks>*': (n) => `${n.fromPoss} tasks go to ${n.to}`,
  'kanban-board.progress>project-dashboard.progress': (n) => `${n.fromPoss} progress drives the ${n.to}`,
  'kanban-board.progress>*': (n) => `${n.fromPoss} progress goes to ${n.to}`,
  'kanban-board.done>flow-terminal.in': (n) => `When a card is done on ${n.from}, the flow starts at ${n.to}`,
  'kanban-board.done>*': (n) => `When a card is done on ${n.from}, ${n.to} runs`,
  'kanban-board.moved>*': (n) => `When a card moves on ${n.from}, ${n.to} runs`,
  '*>kanban-board.addTask': (n) => `${n.from} adds tasks to ${n.to}`,
  '*>kanban-board.moveTask': (n) => `${n.from} moves tasks on ${n.to}`,
  'milestone.milestone>kanban-board.milestone': (n) => `${n.from} is the deadline on ${n.to}`,
  'milestone.milestone>timeline.milestones': (n) => `${n.from} is flagged on the ${n.to}`,
  'milestone.milestone>project-dashboard.milestone': (n) => `${n.to} counts down to ${n.from}`,
  'milestone.reached>*': (n) => `When ${n.from} is reached, ${n.to} runs`,
  'timeline.next>*': (n) => `${n.fromPoss} next milestone goes to ${n.to}`,
  'timeline.overdue>*': (n) => `${n.fromPoss} overdue tasks go to ${n.to}`,
  'checklist.done>*': (n) => `When ${n.from} is complete, ${n.to} runs`,
  'checklist.progress>*': (n) => `${n.fromPoss} progress drives ${n.to}`,
  'project-dashboard.progress>*': (n) => `${n.fromPoss} progress shows on ${n.to}`,
  'flow-terminal.out>*': (n) => `${n.from} passes the token to ${n.to}`,
  'flow-step.out>*': (n) => `After ${n.from}, the token goes to ${n.to}`,
  'flow-decision.yes>*': (n) => `If ${n.from} says yes, ${n.to} runs`,
  'flow-decision.no>*': (n) => `If ${n.from} says no, ${n.to} runs`,
  'sticky-note.text>*': (n) => `${n.fromPoss} note text goes to ${n.to}`,
};
