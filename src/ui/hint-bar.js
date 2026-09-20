// ui/hint-bar.js — a one-line, dismissible hint pill at the top of the viewport ("Drag a card into
// Done…"): what to try first in a starter template. Presentation only; main.js decides per tab
// what it says and remembers a dismissal on the tab.
import { icons } from '../icons.js';

export class HintBar {
  /** @param {object} o { el, onDismiss?() } */
  constructor({ el, onDismiss = () => {} }) {
    Object.assign(this, { el, onDismiss });
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.innerHTML = `<span class="hb-ic">${icons.sparkle}</span><span class="hb-text"></span><button type="button" class="hb-close" title="Dismiss" aria-label="Dismiss hint">${icons.close}</button>`;
    this.textEl = this.el.querySelector('.hb-text');
    this.el.querySelector('.hb-close').addEventListener('click', () => { this.hide(); this.onDismiss(); });
  }
  get isOpen() { return !this.el.hidden; }
  show(text) { this.textEl.textContent = text; this.el.hidden = false; }
  hide() { this.el.hidden = true; }
}
