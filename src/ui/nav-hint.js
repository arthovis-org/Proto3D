// ui/nav-hint.js — a small dismissible pill at the bottom of the viewport about how to move the
// camera. Two messages share it:
//   · the trackpad suggestion: the Navigator counted a few trackpad-like wheel events (its
//     'trackpad' event) while the active preset is not Trackpad, the person never picked a preset
//     in this browser (`nav.chosen`) and the suggestion was never dismissed (`nav.asked`); it offers
//     a Switch button, and × remembers "asked" so it never comes back;
//   · the first-run hint (once per browser, localStorage["proto3d.navhint.v1"]): the gestures for
//     the input device at hand — touch, trackpad or the active preset's mouse bindings — dismissed
//     by × or after a few camera moves.
// Presentation and the two decisions only; the Navigator and the `nav` facade own the state.
import { nav } from '../controls/navigation.js';
import { PRESETS } from '../controls/presets.js';
import { navHint } from './tour.js';
import { icons } from '../icons.js';

export const NAV_HINT_KEY = 'proto3d.navhint.v1';
const NAV_MOVES = 6;         // camera moves before the first-run hint goes away by itself
const FIRST_RUN_DELAY = 1500;
export const TOUCH_HINT = 'One finger orbits · two fingers pan · pinch zooms · tap a block to select';
export const TRACKPAD_SUGGESTION = 'Looks like a trackpad. Switch to Trackpad controls?';
const coarse = () => { try { return !!window.matchMedia?.('(pointer: coarse)').matches; } catch (_) { return false; } };

export class NavHint {
  /** @param {object} o { controls: Navigator, toast?(text, ms), key?, firstRun? (default true) } */
  constructor({ controls, toast = () => {}, key = NAV_HINT_KEY, firstRun = true }) {
    Object.assign(this, { controls, toast, key });
    this.suggest = false;      // the trackpad suggestion is pending
    this.firstRun = firstRun && !this.seen();
    this.moves = 0;
    this.mode = null;          // 'suggest' | 'first' | null (what is on screen)
    const el = document.createElement('div');
    el.id = 'nav-hint'; el.hidden = true; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="nh-ic">${icons.sparkle}</span><span class="nh-text"></span><button type="button" class="nh-action">Switch</button><button type="button" class="nh-close" title="Dismiss" aria-label="Dismiss hint">${icons.close}</button>`;
    document.body.appendChild(el);
    this.el = el; this.textEl = el.querySelector('.nh-text'); this.actionEl = el.querySelector('.nh-action');
    this.actionEl.addEventListener('click', () => this.switchPreset());
    el.querySelector('.nh-close').addEventListener('click', () => this.dismiss());
    controls.addEventListener('trackpad', () => { this.suggest = true; this.render(); });
    controls.addEventListener('touch', () => this.render());
    controls.addEventListener('end', () => { if (this.mode === 'first' && ++this.moves >= NAV_MOVES) { this.markSeen(); this.render(); } });
    nav.onChange(() => this.render());
    if (this.firstRun) setTimeout(() => this.render(), FIRST_RUN_DELAY); else this.render();
  }
  get isOpen() { return !this.el.hidden; }
  get text() { return this.textEl.textContent; }
  seen() { try { return localStorage.getItem(this.key) === '1'; } catch (_) { return true; } }
  markSeen() { this.firstRun = false; try { localStorage.setItem(this.key, '1'); } catch (_) { /* private mode */ } }
  /** Whether the trackpad suggestion should be on screen right now. */
  get wantsSuggestion() { return this.suggest && nav.presetId !== 'trackpad' && !nav.chosen && !nav.asked; }
  /** The first-run text for the device at hand: touch, trackpad, else the active preset's bindings. */
  firstRunText() {
    if (coarse() || this.controls.touchSeen) return TOUCH_HINT;
    if (this.controls.trackpadSeen || nav.presetId === 'trackpad') return PRESETS.trackpad.description.replace(/[,;] /g, ' · ');
    return navHint();
  }
  render() {
    if (this.wantsSuggestion) this._show('suggest', TRACKPAD_SUGGESTION, true);
    else if (this.firstRun) this._show('first', this.firstRunText(), false);
    else this.hide();
  }
  _show(mode, text, action) { this.mode = mode; this.textEl.textContent = text; this.actionEl.hidden = !action; this.el.hidden = false; }
  hide() { this.mode = null; this.el.hidden = true; }
  switchPreset() { nav.setPreset('trackpad'); this.suggest = false; this.toast(`Trackpad controls · ${nav.binding('orbit')} orbits, pinch zooms`, 2400); this.render(); }
  dismiss() {
    if (this.mode === 'suggest') { nav.markAsked(); this.suggest = false; }
    else this.markSeen();
    this.render();
  }
}
