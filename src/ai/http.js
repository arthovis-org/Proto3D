// ai/http.js — the one fetch wrapper the provider adapters use: optional proxy rewriting (a
// per-provider CORS proxy such as proxy/cloudflare-worker.js), timeouts, AbortSignal plumbing,
// and error mapping into ProviderError with a plain-language message and a suggested fix.
// Keys are passed in headers by the caller; nothing here logs a request or a header.

/** Error codes: no-key · auth · rate · bad-request · server · network · cors · cancelled · timeout · parse. */
export class ProviderError extends Error {
  constructor(code, message, { fix = null, status = 0, cause = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code; this.fix = fix; this.status = status; this.cause = cause;
  }
}
export const isAbort = (e) => e && (e.name === 'AbortError' || e.code === 'cancelled');

/** Rewrite a provider URL through a proxy base: `${proxy}/${host}${path}` (the worker maps it back). */
export function viaProxy(url, proxy) {
  if (!proxy) return url;
  const u = new URL(url);
  const base = proxy.replace(/\/+$/, '');
  return `${base}/${u.host}${u.pathname}${u.search}`;
}

/** Plain-language error for a failed HTTP response. */
export async function errorFromResponse(res, providerLabel) {
  let detail = '';
  try { const t = await res.text(); try { const j = JSON.parse(t); detail = j.error?.message || j.detail || j.message || j.msg || (typeof j.error === 'string' ? j.error : '') || ''; if (Array.isArray(j.detail)) detail = j.detail.map((d) => d.msg || JSON.stringify(d)).join('; '); } catch (_) { detail = t.slice(0, 200); } } catch (_) { /* no body */ }
  const s = res.status;
  if (s === 401 || s === 403) return new ProviderError('auth', `${providerLabel} rejected the key${detail ? ` (${detail})` : ''}`, { fix: 'connections', status: s });
  if (s === 402) return new ProviderError('auth', `${providerLabel}: no credit left${detail ? ` (${detail})` : ''}`, { fix: 'connections', status: s });
  if (s === 429) return new ProviderError('rate', `${providerLabel} is rate-limiting requests — try again in a moment${detail ? ` (${detail})` : ''}`, { fix: 'retry', status: s });
  if (s >= 500) return new ProviderError('server', `${providerLabel} had a server error (${s})${detail ? `: ${detail}` : ''}`, { fix: 'retry', status: s });
  return new ProviderError('bad-request', `${providerLabel} did not accept the request (${s})${detail ? `: ${detail}` : ''}`, { fix: null, status: s });
}

/**
 * fetch with a timeout, an outer AbortSignal and error mapping. Resolves with the Response
 * (any status < 400); rejects with a ProviderError otherwise.
 */
export async function request(url, { method = 'GET', headers = {}, body, signal, timeout = 60000, proxy = null, label = 'The provider' } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) throw new ProviderError('cancelled', 'Cancelled'); signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = timeout > 0 ? setTimeout(() => ctrl.abort(new Error('timeout')), timeout) : null;
  try {
    const res = await fetch(viaProxy(url, proxy), { method, headers, body, signal: ctrl.signal, mode: 'cors' });
    if (!res.ok) throw await errorFromResponse(res, label);
    return res;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (signal?.aborted) throw new ProviderError('cancelled', 'Cancelled');
    if (ctrl.signal.aborted) throw new ProviderError('timeout', `${label} did not answer in time`, { fix: 'retry' });
    // a blocked CORS preflight / offline both surface as a TypeError from fetch
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) throw new ProviderError('network', 'You are offline', { fix: 'retry', cause: e });
    throw new ProviderError('cors', `${label} could not be reached from the browser (blocked request or CORS). A proxy URL in Connections fixes this.`, { fix: 'connections', cause: e });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
export async function requestJSON(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  try { return await res.json(); } catch (e) { throw new ProviderError('parse', `${opts.label || 'The provider'} returned something that is not JSON`, { cause: e }); }
}

/**
 * Read a Server-Sent-Events body chunk by chunk. Calls `onEvent(dataString)` for every `data:`
 * payload (comment lines such as ": OPENROUTER PROCESSING" are skipped), stops at `[DONE]`.
 */
export async function readSSE(res, onEvent, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    if (signal?.aborted) { try { await reader.cancel(); } catch (_) { /* ignore */ } throw new ProviderError('cancelled', 'Cancelled'); }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        onEvent(data);
      }
    }
  }
  if (buf.startsWith('data:')) { const data = buf.slice(5).trim(); if (data && data !== '[DONE]') onEvent(data); }
}

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ProviderError('cancelled', 'Cancelled')); }, { once: true });
});
