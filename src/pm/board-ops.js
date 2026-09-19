// pm/board-ops.js — how a Kanban board's data changes are committed: every edit (a 3D card
// drag, a panel field, an "add card" pulse) becomes one undoable `setParam('board')` command,
// and a move that lands in the last column also pulses the board's `when a card is done` output. Shared by the
// board component (3D interaction, engine inputs) and its panel editors.
import * as cmd from '../core/commands.js';
import { lastColumn } from './model.js';

/**
 * Commit a model result ({ board, card?, from?, to?, changed? }) on a board instance.
 * `history` may be null (engine-driven edits are not undoable; they still autosave).
 */
export function commitBoard(node, history, res, label) {
  if (!res || !res.board) return false;
  const c = cmd.setParam(node.world, node, 'board', res.board);
  if (label) c.label = label;
  if (history) history.execute(c); else c.do();
  node.faceDirty = true;
  if (res.from && res.to && res.changed !== false) {
    node.emit('moved', { card: res.card, from: res.from.title, to: res.to.title });
    if (res.from.id !== res.to.id && res.to.id === lastColumn(res.board).id) node.emit('done', res.card);
  }
  return true;
}
