// ui/file-menu.js — the File dropdown in the top bar: New, Save JSON, Load JSON, Examples.
export class FileMenu {
  /**
   * @param {object} o { button, menu, examples: [{ id, label }], onNew, onSave, onLoad, onExample(id) }
   */
  constructor({ button, menu, examples, onNew, onSave, onLoad, onExample }) {
    Object.assign(this, { button, menu, examples, onNew, onSave, onLoad, onExample });
    this._render();
    button.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    window.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && e.target !== button) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }
  _render() {
    const item = (label, fn, id) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (id) b.dataset.action = id; b.addEventListener('click', () => { this.close(); fn(); }); return b; };
    this.menu.innerHTML = '';
    this.menu.appendChild(item('New (empty)', this.onNew, 'new'));
    this.menu.appendChild(item('Save JSON…', this.onSave, 'save'));
    this.menu.appendChild(item('Load JSON…', this.onLoad, 'load'));
    const sep = document.createElement('div'); sep.className = 'menu-sep'; sep.textContent = 'Examples'; this.menu.appendChild(sep);
    for (const ex of this.examples) this.menu.appendChild(item(ex.label, () => this.onExample(ex.id), `example:${ex.id}`));
  }
  get isOpen() { return !this.menu.hidden; }
  toggle() { this.menu.hidden ? this.open() : this.close(); }
  open() { this.menu.hidden = false; this.button.classList.add('on'); }
  close() { this.menu.hidden = true; this.button.classList.remove('on'); }
}
