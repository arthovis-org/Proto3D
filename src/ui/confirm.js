// ui/confirm.js — small themed dialogs on the modal shell (no window.confirm / window.prompt):
// `confirmDialog` shows a title, a sentence and two or three buttons and resolves the id of the
// one pressed ('cancel' on Esc or a click on the backdrop); `promptDialog` asks for one line of
// text and resolves it (null when cancelled). One dialog at a time; focus returns where it was.
import { icons } from '../icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let openEl = null;
/** True while a confirm / prompt dialog is up (main.js treats it as a modal). */
export const isDialogOpen = () => !!openEl;

function shell({ icon = icons.help, title, text, detail = '', body = '', buttons }) {
  const el = document.createElement('div'); el.className = 'modal-backdrop confirm-backdrop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'confirm-title');
  el.innerHTML = `<div class="modal confirm"><div class="confirm-body"><span class="modal-icon">${icon}</span><div class="confirm-text"><h2 id="confirm-title">${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}${detail ? `<small>${detail}</small>` : ''}${body}</div></div><div class="confirm-btns">${buttons.map((b) => `<button type="button" class="${b.kind || 'ghost'}" data-id="${esc(b.id)}"${b.default ? ' data-default="1"' : ''}>${esc(b.label)}</button>`).join('')}</div></div>`;
  return el;
}
function run(el, { onKey, resolveWith }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const finish = (v) => { if (openEl !== el) return; openEl = null; el.remove(); window.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
    const key = (e) => { if (openEl !== el) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(resolveWith.cancel); return; } if (onKey?.(e, finish)) { e.preventDefault(); e.stopPropagation(); return; } e.stopPropagation(); };
    el.addEventListener('pointerdown', (e) => { if (e.target === el) finish(resolveWith.cancel); });
    el.querySelectorAll('.confirm-btns button').forEach((b) => b.addEventListener('click', () => finish(resolveWith.button(b))));
    window.addEventListener('keydown', key, true);
    if (openEl) { openEl.remove(); openEl = null; }
    openEl = el; document.body.appendChild(el);
    (el.querySelector('[data-default="1"]') || el.querySelector('.confirm-btns button'))?.focus();
  });
}

/**
 * @param {object} o { title, text, detail?, icon?, buttons: [{ id, label, kind?: 'primary' | 'ghost' | 'danger', default?: true }] }
 * @returns {Promise<string>} the pressed button's id, 'cancel' when dismissed
 */
export function confirmDialog({ title, text = '', detail = '', icon, buttons }) {
  const el = shell({ icon, title, text, detail, buttons });
  return run(el, {
    resolveWith: { cancel: 'cancel', button: (b) => b.dataset.id },
    onKey: (e, finish) => { if (e.key === 'Enter' && !e.target.closest?.('button')) { const d = el.querySelector('[data-default="1"]'); if (d) { finish(d.dataset.id); return true; } } return false; },
  });
}
/** One line of text; resolves the trimmed value or null. */
export function promptDialog({ title, text = '', value = '', placeholder = '', ok = 'OK', icon }) {
  const el = shell({ icon: icon || icons.text, title, text, body: `<input type="text" class="confirm-input" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false">`, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: ok, kind: 'primary', default: true }] });
  const input = el.querySelector('input');
  const p = run(el, {
    resolveWith: { cancel: null, button: (b) => (b.dataset.id === 'ok' ? input.value.trim() : null) },
    onKey: (e, finish) => { if (e.key === 'Enter') { finish(input.value.trim()); return true; } return false; },
  });
  input.focus(); input.select();
  return p;
}
