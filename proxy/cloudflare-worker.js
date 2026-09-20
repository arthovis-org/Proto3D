// proxy/cloudflare-worker.js — a minimal CORS proxy for Proto3D's Generate components.
//
// Why: the browser talks to OpenRouter, fal.ai and kie.ai directly. Some networks block those
// hosts and some providers do not send CORS headers for browser callers; this worker forwards
// the request unchanged (method, path, query, body and the Authorization header the browser
// sent) to an allow-listed provider host and adds the CORS headers on the way back. It injects
// nothing: no key lives here, so deploying it does not make the worker a secret.
//
// Deploy (one click, free tier is enough):
//   1. https://dash.cloudflare.com → Workers & Pages → Create → "Hello world" → Deploy.
//   2. Edit code → replace everything with this file → Deploy.
//   3. Optional but recommended: set ALLOWED_ORIGINS below to your Proto3D origin(s) so only
//      your pages can use the worker.
//   4. In Proto3D → Connections → the provider's "Proxy URL" → paste https://<name>.<you>.workers.dev
//
// URL shape the app uses:  https://<worker>/<provider-host>/<path>?<query>
//   e.g. https://p.example.workers.dev/openrouter.ai/api/v1/chat/completions
export default {
  async fetch(request) {
    const ALLOWED_HOSTS = ['openrouter.ai', 'queue.fal.run', 'fal.run', 'rest.alpha.fal.ai', 'api.kie.ai'];
    const ALLOWED_ORIGINS = ['*'];   // e.g. ['https://arthovis-org.github.io', 'http://localhost:8000']

    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes('*') ? '*' : (ALLOWED_ORIGINS.includes(origin) ? origin : null);
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin || 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Authorization, Content-Type, Accept, HTTP-Referer, X-Title',
      'Access-Control-Expose-Headers': 'Content-Type, X-Request-Id',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowOrigin) return new Response('origin not allowed', { status: 403, headers: cors });

    const url = new URL(request.url);
    const [, host, ...rest] = url.pathname.split('/');
    if (!host || !ALLOWED_HOSTS.includes(host)) return new Response(`host not allowed: ${host || '(none)'}`, { status: 403, headers: cors });
    const target = `https://${host}/${rest.join('/')}${url.search}`;

    // forward as-is (method, body, the browser's own Authorization header); drop hop-by-hop / origin headers
    const headers = new Headers(request.headers);
    for (const h of ['host', 'origin', 'referer', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip']) headers.delete(h);
    const init = { method: request.method, headers, redirect: 'follow' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
    let upstream;
    try { upstream = await fetch(target, init); }
    catch (e) { return new Response(`upstream error: ${e.message}`, { status: 502, headers: cors }); }

    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    out.delete('content-security-policy'); out.delete('content-encoding');   // the runtime re-encodes; streaming bodies pass through untouched
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  },
};
