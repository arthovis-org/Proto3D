// ui/connections.js — the Connections page: one card per provider (glyph, description, masked
// key field, Test with latency and balance, optional proxy URL, status chip), the Demo card, the
// vault's passphrase section, storage and spend. A modal built like a settings page: 8-pt
// spacing, Inter, subtle borders, focus rings, keyboard accessible (Esc closes, Tab cycles).
// Opened from the top bar (plug icon), the ? menu and any Generate component without a key.
import { providerRegistry, providerStatus } from '../ai/providers/index.js';
import { vault, maskKey } from '../ai/vault.js';
import { store } from '../ai/store.js';
import { spend, fmtUSD } from '../ai/pricing.js';
import { jobs } from '../ai/jobs.js';
import { icons } from '../icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_TEXT = { demo: 'Always available', connected: 'Connected', missing: 'Not connected', locked: 'Locked' };

export class Connections {
  /** @param {object} o { onChange?() } */
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.el = document.createElement('div');
    this.el.id = 'connections'; this.el.className = 'modal-backdrop'; this.el.hidden = true;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-labelledby', 'connections-title');
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    window.addEventListener('keydown', (e) => { if (!this.el.hidden && e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this._tests = {};   // providerId → { state, text }
    vault.onChange(() => { if (!this.el.hidden) this.render(); this.onChange(); });
    spend.onChange(() => { if (!this.el.hidden) this._renderFooter(); });
  }
  get isOpen() { return !this.el.hidden; }
  open(providerId = null) {
    this.focusProvider = providerId;
    this.el.hidden = false;
    this.render();
    const target = providerId ? this.el.querySelector(`[data-provider="${providerId}"] input[type="password"], [data-provider="${providerId}"] input`) : this.el.querySelector('.modal-close');
    setTimeout(() => target?.focus(), 30);
  }
  close() { this.el.hidden = true; this._restoreFocus?.(); }
  toggle(id) { if (this.isOpen) this.close(); else this.open(id); }

  render() {
    const ids = providerRegistry.ids();
    this.el.innerHTML = `
      <div class="modal connections">
        <header class="modal-head">
          <span class="modal-icon">${icons.plug}</span>
          <div><h2 id="connections-title">Connections</h2><p>Keys stay in this browser, encrypted, and go only to the provider you chose. Nothing is stored in your saved worlds.</p></div>
          <button type="button" class="modal-close" aria-label="Close">${icons.close}</button>
        </header>
        <div class="modal-body">
          ${vault.locked ? this._lockedHTML() : ''}
          <div class="provider-grid">${ids.map((id) => this._cardHTML(providerRegistry.get(id))).join('')}</div>
          ${this._vaultHTML()}
        </div>
        <footer class="modal-foot" id="connections-foot"></footer>
      </div>`;
    this.el.querySelector('.modal-close').addEventListener('click', () => this.close());
    for (const id of ids) this._bindCard(id);
    this._bindVault();
    this._renderFooter();
    if (this.focusProvider) this.el.querySelector(`[data-provider="${this.focusProvider}"]`)?.classList.add('focus');
  }
  _statusChip(id) {
    const st = providerStatus(id);
    const t = this._tests[id];
    if (t?.state === 'error') return `<span class="chip bad" title="${esc(t.text)}">Error · ${esc(t.text)}</span>`;
    if (t?.state === 'ok') return `<span class="chip good">Connected · ${esc(t.text)}</span>`;
    if (t?.state === 'testing') return `<span class="chip">Testing…</span>`;
    return `<span class="chip ${st === 'connected' || st === 'demo' ? 'good' : st === 'locked' ? 'warn' : ''}">${STATUS_TEXT[st]}</span>`;
  }
  _cardHTML(p) {
    const st = providerStatus(p.id);
    const key = vault.keyFor(p.id);
    const caps = p.capabilities.filter((c) => ['text', 'image', 'video', 'audio'].includes(c));
    if (!p.needsKey) {
      return `<section class="provider-card demo" data-provider="${p.id}">
        <div class="pc-head"><span class="pc-glyph">${p.glyph}</span><div><h3>${esc(p.label)} <span class="tag">offline</span></h3><div class="pc-caps">${caps.map((c) => `<span>${c}</span>`).join('')}</div></div>${this._statusChip(p.id)}</div>
        <p class="pc-desc">${esc(p.description)}</p>
        <p class="pc-note">Every Generate component starts on Demo so a scene runs without keys. Pick a real provider in the component's panel when you are ready.</p>
      </section>`;
    }
    return `<section class="provider-card" data-provider="${p.id}">
      <div class="pc-head"><span class="pc-glyph">${p.glyph}</span><div><h3>${esc(p.label)}</h3><div class="pc-caps">${caps.map((c) => `<span>${c}</span>`).join('')}</div></div>${this._statusChip(p.id)}</div>
      <p class="pc-desc">${esc(p.description)} ${p.keyUrl ? `<a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Get a key ${icons.external}</a>` : ''}</p>
      <label class="field"><span>API key</span>
        <span class="field-row"><input type="password" autocomplete="off" spellcheck="false" placeholder="${esc(p.keyHint || 'paste your key')}" value="${esc(key || '')}" ${vault.locked ? 'disabled' : ''} data-role="key" aria-label="${esc(p.label)} API key" />
        <button type="button" class="ghost" data-role="reveal" title="Show / hide">${icons.eye}</button>
        <button type="button" data-role="save" ${vault.locked ? 'disabled' : ''}>Save</button>
        <button type="button" data-role="test" ${vault.locked ? 'disabled' : ''}>Test</button></span>
        <small class="field-hint" data-role="keyhint">${key ? `Saved · ${esc(maskKey(key))}` : 'Pasted keys are saved encrypted in this browser only.'}</small>
      </label>
      <details class="field-more" ${vault.proxyFor(p.id) ? 'open' : ''}><summary>Proxy URL (optional)</summary>
        <span class="field-row"><input type="url" placeholder="https://your-worker.workers.dev" value="${esc(vault.proxyFor(p.id))}" data-role="proxy" aria-label="${esc(p.label)} proxy URL" /><button type="button" data-role="saveproxy">Save</button></span>
        <small class="field-hint">${esc(p.corsNote)} Deploy <code>proxy/cloudflare-worker.js</code> (see docs/AI-GENERATION.md) and paste its URL; the browser still sends its own key.</small>
      </details>
      ${key ? `<div class="pc-actions"><button type="button" class="ghost danger" data-role="forget">Forget key</button></div>` : ''}
    </section>`;
  }
  _bindCard(id) {
    const p = providerRegistry.get(id);
    const card = this.el.querySelector(`[data-provider="${id}"]`);
    if (!card || !p.needsKey) return;
    const keyEl = card.querySelector('[data-role="key"]');
    const hint = card.querySelector('[data-role="keyhint"]');
    card.querySelector('[data-role="reveal"]').addEventListener('click', () => { keyEl.type = keyEl.type === 'password' ? 'text' : 'password'; });
    const save = async () => { await vault.setKey(id, keyEl.value); this._tests[id] = null; this.render(); this.el.querySelector(`[data-provider="${id}"] [data-role="test"]`)?.focus(); };
    card.querySelector('[data-role="save"]').addEventListener('click', save);
    keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    keyEl.addEventListener('input', () => { hint.textContent = keyEl.value ? 'Not saved yet — press Save (or Enter).' : 'Pasted keys are saved encrypted in this browser only.'; });
    card.querySelector('[data-role="test"]').addEventListener('click', async () => {
      const key = keyEl.value.trim() || vault.keyFor(id);
      if (!key) { this._tests[id] = { state: 'error', text: 'enter a key first' }; this.render(); return; }
      if (keyEl.value.trim() && keyEl.value.trim() !== vault.keyFor(id)) await vault.setKey(id, keyEl.value.trim());
      this._tests[id] = { state: 'testing', text: '' }; this.render();
      try {
        const r = await p.testKey({ key, proxy: vault.proxyFor(id) });
        const bal = r.balance !== null && r.balance !== undefined ? (r.balanceUnit === 'credits' ? `${r.balance} credits` : `${fmtUSD(r.balance)} left`) : null;
        this._tests[id] = { state: 'ok', text: [`${r.latencyMs} ms`, bal].filter(Boolean).join(' · ') };
      } catch (e) { this._tests[id] = { state: 'error', text: e.message || String(e) }; }
      this.render();
    });
    card.querySelector('[data-role="saveproxy"]').addEventListener('click', () => { vault.setProxy(id, card.querySelector('[data-role="proxy"]').value); this.render(); });
    card.querySelector('[data-role="forget"]')?.addEventListener('click', async () => { await vault.forget(id); this._tests[id] = null; this.render(); });
  }
  _lockedHTML() {
    return `<section class="vault-locked" data-role="locked">
      <span class="pc-glyph">${icons.key}</span>
      <div><h3>The key vault is locked</h3><p>Enter your passphrase to use your saved keys in this session.${vault.hint ? ` Hint: <i>${esc(vault.hint)}</i>` : ''}</p>
      <span class="field-row"><input type="password" data-role="unlock-pass" placeholder="passphrase" autocomplete="current-password" aria-label="Vault passphrase" /><button type="button" data-role="unlock">Unlock</button><button type="button" class="ghost danger" data-role="reset">Forget everything</button></span>
      <small class="field-hint" data-role="unlock-msg"></small></div>
    </section>`;
  }
  _vaultHTML() {
    return `<section class="vault-section">
      <div class="pc-head"><span class="pc-glyph">${icons.key}</span><div><h3>Key vault</h3><div class="pc-caps"><span>AES-GCM 256</span><span>PBKDF2</span><span>${vault.mode === 'passphrase' ? 'passphrase' : 'device key'}</span></div></div>
      <span class="chip ${vault.mode === 'passphrase' ? 'good' : ''}">${vault.mode === 'passphrase' ? 'Passphrase protected' : 'Device key'}</span></div>
      <p class="pc-desc">${vault.available ? (vault.mode === 'passphrase'
        ? 'Keys are encrypted with a key derived from your passphrase. After a reload the vault stays locked until you enter it. Nobody can recover it for you.'
        : 'Keys are encrypted with a random device secret that lives next to them in this browser profile — that hides them from a glance, not from someone with access to this profile. Add a passphrase for real protection.')
        : 'WebCrypto is unavailable in this browser, so keys cannot be saved; they work for this session only.'}</p>
      ${vault.locked ? '' : `<span class="field-row"><input type="password" data-role="pass" placeholder="${vault.mode === 'passphrase' ? 'new passphrase (empty removes it)' : 'choose a passphrase'}" autocomplete="new-password" aria-label="New passphrase" /><input type="text" data-role="hint" placeholder="hint (optional)" value="${esc(vault.hint)}" aria-label="Passphrase hint" /><button type="button" data-role="setpass">${vault.mode === 'passphrase' ? 'Change' : 'Protect'}</button></span>`}
      <small class="field-hint" data-role="passmsg"></small>
    </section>`;
  }
  _bindVault() {
    const unlock = this.el.querySelector('[data-role="unlock"]');
    if (unlock) {
      const pass = this.el.querySelector('[data-role="unlock-pass"]'), msg = this.el.querySelector('[data-role="unlock-msg"]');
      const go = async () => { const ok = await vault.unlock(pass.value); if (ok) this.render(); else { msg.textContent = 'That passphrase does not open the vault.'; msg.classList.add('bad'); pass.select(); } };
      unlock.addEventListener('click', go); pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      this.el.querySelector('[data-role="reset"]').addEventListener('click', async () => { if (confirm('Forget every saved key and remove the passphrase? You will re-enter your keys.')) { await vault.reset(); this.render(); } });
    }
    const set = this.el.querySelector('[data-role="setpass"]');
    if (set) set.addEventListener('click', async () => {
      const pass = this.el.querySelector('[data-role="pass"]').value, hint = this.el.querySelector('[data-role="hint"]').value;
      await vault.setPassphrase(pass, hint);
      this.render();
      this.el.querySelector('[data-role="passmsg"]').textContent = pass ? 'Passphrase set. You will be asked for it after a reload.' : 'Passphrase removed; back to the device key.';
    });
  }
  async _renderFooter() {
    const foot = this.el.querySelector('#connections-foot'); if (!foot) return;
    const [count, bytes] = await Promise.all([store.count(), store.bytes()]);
    const running = jobs.active.length;
    foot.innerHTML = `<span>Session spend <b>${fmtUSD(spend.total)}</b> · ${spend.count} run${spend.count === 1 ? '' : 's'}${running ? ` · ${running} running` : ''}</span>
      <span>Stored results <b>${count}</b> · ${(bytes / 1048576).toFixed(1)} MB <button type="button" class="ghost" data-role="clearstore">Clear</button></span>
      <span class="grow"></span><a href="docs/AI-GENERATION.md" target="_blank" rel="noopener">How this works ${icons.external}</a>`;
    foot.querySelector('[data-role="clearstore"]').addEventListener('click', async () => { if (confirm('Remove every stored generated file from this browser? Results still shown on faces will fail to load after a reload.')) { await store.clear(); this._renderFooter(); } });
  }
}
