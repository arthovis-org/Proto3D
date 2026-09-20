// ai/vault.js — where provider keys live. Keys are kept in memory while the page is open and
// persisted in localStorage encrypted with WebCrypto (AES-GCM 256). The AES key is derived with
// PBKDF2 (310 000 rounds, SHA-256) from either
//   • a passphrase you choose (the vault is then *locked* after a reload until you enter it), or
//   • a random device secret the vault generates and keeps in localStorage next to the ciphertext
//     ("device key" mode: this only obfuscates — anyone with access to this browser profile can
//     read the keys; a passphrase is the real protection).
// Keys are never logged, never put in the world JSON and never sent anywhere but the provider
// (or the proxy you configured). Per-provider proxy URLs are ordinary settings (not secret).
const VAULT_KEY = 'proto3d.vault.v1';          // { v, mode, salt, iv, data, hint }
const DEVICE_KEY = 'proto3d.vault.device.v1';  // random device secret (device mode)
const SETTINGS_KEY = 'proto3d.ai.settings.v1'; // { proxies: { providerId: url }, concurrency, approveAbove }
const ROUNDS = 310000;

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };

async function deriveKey(secret, salt) {
  const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function deviceSecret() {
  let s = null;
  try { s = localStorage.getItem(DEVICE_KEY); } catch (_) { /* private mode */ }
  if (!s) { s = b64(rnd(32)); try { localStorage.setItem(DEVICE_KEY, s); } catch (_) { /* ignore */ } }
  return s;
}

class Vault {
  constructor() {
    this.keys = {};                  // providerId → key string (memory only)
    this.mode = 'device';            // 'device' | 'passphrase'
    this.locked = false;             // passphrase mode, not yet unlocked this session
    this.hint = '';
    this.available = !!subtle();
    this.settings = { proxies: {}, concurrency: 3, approveAbove: 0.05 };
    this._listeners = new Set();
    this._passphrase = null;         // kept in memory only while unlocked (re-encrypt on change)
    this.ready = this._load();
  }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit() { this._listeners.forEach((cb) => cb(this)); }

  async _load() {
    try { const s = localStorage.getItem(SETTINGS_KEY); if (s) this.settings = { ...this.settings, ...JSON.parse(s) }; } catch (_) { /* ignore */ }
    let rec = null;
    try { const s = localStorage.getItem(VAULT_KEY); rec = s ? JSON.parse(s) : null; } catch (_) { rec = null; }
    if (!rec) { this._emit(); return; }
    this.mode = rec.mode || 'device'; this.hint = rec.hint || '';
    if (this.mode === 'passphrase') { this.locked = true; this._emit(); return; }
    if (!this.available) { this._emit(); return; }
    try { this.keys = await this._decrypt(rec, deviceSecret()); } catch (_) { this.keys = {}; }
    this._emit();
  }
  async _decrypt(rec, secret) {
    const key = await deriveKey(secret, unb64(rec.salt));
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.data));
    return JSON.parse(dec.decode(plain));
  }
  async _persist() {
    if (!this.available) return false;
    const secret = this.mode === 'passphrase' ? this._passphrase : deviceSecret();
    if (this.mode === 'passphrase' && !secret) return false;
    const salt = rnd(16), iv = rnd(12);
    const key = await deriveKey(secret, salt);
    const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(this.keys)));
    const rec = { v: 1, mode: this.mode, salt: b64(salt), iv: b64(iv), data: b64(data), hint: this.hint || '' };
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(rec)); return true; } catch (_) { return false; }
  }
  _persistSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (_) { /* ignore */ } }

  /* ---- keys ---- */
  /** The key for a provider, or null (also null while the vault is locked). */
  keyFor(id) { return this.locked ? null : this.keys[id] || null; }
  has(id) { return !!this.keyFor(id); }
  async setKey(id, value) {
    if (this.locked) throw new Error('The vault is locked');
    const v = String(value || '').trim();
    if (v) this.keys[id] = v; else delete this.keys[id];
    await this._persist();
    this._emit();
  }
  async forget(id) { return this.setKey(id, ''); }
  async clearAll() { this.keys = {}; await this._persist(); this._emit(); }

  /* ---- passphrase ---- */
  /** Protect the vault with a passphrase (re-encrypts). An empty passphrase goes back to device mode. */
  async setPassphrase(pass, hint = '') {
    if (this.locked) throw new Error('Unlock the vault first');
    pass = String(pass || '');
    if (pass) { this.mode = 'passphrase'; this._passphrase = pass; this.hint = hint; }
    else { this.mode = 'device'; this._passphrase = null; this.hint = ''; }
    await this._persist();
    this._emit();
  }
  /** Unlock a passphrase-protected vault after a reload. Resolves true when the passphrase fits. */
  async unlock(pass) {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null'); } catch (_) { rec = null; }
    if (!rec || rec.mode !== 'passphrase') { this.locked = false; this._emit(); return true; }
    try { this.keys = await this._decrypt(rec, String(pass || '')); }
    catch (_) { return false; }
    this._passphrase = String(pass || ''); this.locked = false; this._emit();
    return true;
  }
  /** Drop a passphrase-protected vault you cannot unlock (keys are lost; you re-enter them). */
  async reset() {
    this.keys = {}; this.mode = 'device'; this.locked = false; this._passphrase = null; this.hint = '';
    try { localStorage.removeItem(VAULT_KEY); } catch (_) { /* ignore */ }
    this._emit();
  }

  /* ---- settings (not secret) ---- */
  proxyFor(id) { return this.settings.proxies?.[id] || ''; }
  setProxy(id, url) { this.settings.proxies = { ...(this.settings.proxies || {}) }; const u = String(url || '').trim(); if (u) this.settings.proxies[id] = u; else delete this.settings.proxies[id]; this._persistSettings(); this._emit(); }
  setSetting(k, v) { this.settings[k] = v; this._persistSettings(); this._emit(); }
  /** Masked preview for the UI: "sk-or-v1-…4f2a". */
  static mask(key) { const k = String(key || ''); if (k.length <= 8) return k ? '••••' : ''; return `${k.slice(0, 6)}…${k.slice(-4)}`; }
}

export const vault = new Vault();
export const maskKey = Vault.mask;
export default vault;
