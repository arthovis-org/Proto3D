// core/history.js — undo / redo command stack. Commands are { label, do(), undo() } objects.
// `executeCoalesced(key, cmd)` merges rapid edits (typing in a param field) into one entry.
export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this._coalesceKey = null;
    this._coalesceAt = 0;
    this.locked = false;         // a read-only preview: execute() refuses and calls onLocked
    this.onLocked = null;
  }
  /** Swap the stacks for another project's (tabs): returns the previous { undo, redo }. */
  swap(state) {
    const prev = { undo: this.undoStack, redo: this.redoStack };
    this.undoStack = state?.undo || []; this.redoStack = state?.redo || [];
    this._coalesceKey = null;
    this._notify();
    return prev;
  }
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  _notify() { this.listeners.forEach((cb) => cb(this)); }

  execute(cmd) {
    if (this.locked) { this.onLocked?.(cmd); return cmd; }
    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._coalesceKey = null;
    this._notify();
    return cmd;
  }
  /** Like execute, but if the previous command has the same key (within 1.5 s) it is replaced: the
   *  new command's `do` runs and the merged entry keeps the first command's `undo`. */
  executeCoalesced(key, cmd) {
    if (this.locked) { this.onLocked?.(cmd); return cmd; }
    const now = performance.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && this._coalesceKey === key && now - this._coalesceAt < 1500) {
      cmd.do();
      last.do = cmd.do;                  // redo replays the latest value
      last.label = cmd.label;
      this._coalesceAt = now;
      this.redoStack.length = 0;
      this._notify();
      return last;
    }
    this.execute(cmd);
    this._coalesceKey = key;
    this._coalesceAt = now;
    return cmd;
  }
  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this._coalesceKey = null;
    this._notify();
    return true;
  }
  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    this._notify();
    return true;
  }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this._coalesceKey = null; this._notify(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
