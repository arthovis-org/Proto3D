// simulate.js — an offline stand-in for Jev so every demo runs without a key. It is not a model:
// it tokenises the state and each option's text, scores by keyword overlap through a small synonym
// table for the demo domains, and turns the scores into a softmax distribution with a confidence.
// Deterministic (same input → same answer), labelled "Simulated" wherever it shows.

const STOP = new Set('a an the and or of to in on for is it its this that i my me we you your can be was were are am with at as by from up do does did have has had will would should could not no yes please hi hello there here them they he she his her our us so if then than too very just about into over out off'.split(' '));

/** Crude stemmer: strip common suffixes, then a trailing e (charges / charged / charge → charg). */
export function stem(w) {
  let s = w;
  if (s.length > 4) for (const suf of ['ing', 'ed', 'es', 's']) if (s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}
/** Synonym groups for the demo domains; every member maps to its first word. */
const GROUPS = [
  ['return', 'exchange', 'swap', 'refund', 'wrong', 'damaged', 'broken item', 'size', 'fit', 'replace', 'replacement', 'defective'],
  ['shipping', 'delivery', 'deliver', 'parcel', 'package', 'tracking', 'track', 'late', 'where', 'arrive', 'arrived', 'shipment', 'courier', 'due', 'dispatch', 'status'],
  ['billing', 'charge', 'charged', 'invoice', 'card', 'payment', 'paid', 'twice', 'double', 'receipt', 'subscription', 'price', 'money', 'month', 'monthly', 'statement', 'bill', 'debit'],
  ['urgent', 'asap', 'immediately', 'now', 'angry', 'furious', 'critical', 'emergency', 'blocker', 'blocking'],
  ['crash', 'crashes', 'crashing', 'outage', 'down', 'offline', 'unavailable', 'loss', 'lost', 'corrupt', 'security', 'breach', 'leak'],
  ['bug', 'fail', 'fails', 'failing', 'failure', 'error', 'broken', 'silently', 'timeout', 'duplicate'],
  ['minor', 'typo', 'cosmetic', 'polish', 'nicetohave', 'someday', 'illustration', 'refresh', 'tweak', 'wording', 'copy'],
  ['personal', 'private', 'pii', 'contact', 'confidential'],
  ['phone', 'number', 'mobile', 'telephone', 'call', 'text'],
  ['email', 'mail', 'inbox'],
  ['address', 'street', 'home', 'postcode', 'zip'],
  ['launch', 'marketing', 'product', 'campaign', 'tweet', 'post', 'announcement', 'content', 'upbeat', 'hashtag', 'slogan', 'tagline', 'copywriting'],
  ['image', 'images', 'picture', 'pictures', 'photo', 'photos', 'media', 'visual', 'visuals', 'asset', 'assets'],
  ['grid', 'gallery', 'wall', 'mosaic', 'collage', 'tiles'],
  ['task', 'tasks', 'card', 'cards', 'ticket', 'todo', 'backlog', 'board', 'kanban'],
  ['show', 'display', 'render', 'view', 'see', 'preview'],
  ['decide', 'route', 'routing', 'triage', 'classify', 'which', 'handles', 'handle', 'team', 'department', 'lane'],
  ['check', 'guard', 'gate', 'allow', 'block', 'safe', 'unsafe', 'verify', 'validate', 'approve'],
  ['rank', 'order', 'sort', 'prioritise', 'prioritize', 'priority', 'important', 'urgency'],
  ['score', 'rate', 'rating', 'grade', 'rubric', 'level'],
  ['note', 'sticky', 'reminder', 'memo'],
  ['person', 'people', 'member', 'teammate', 'assignee', 'owner'],
  ['screen', 'phone', 'device', 'laptop', 'monitor', 'tablet'],
  ['timeline', 'gantt', 'schedule', 'dates', 'calendar'],
  ['button', 'press', 'click', 'trigger', 'input'],
];
const CANON = new Map();
for (const g of GROUPS) { const head = stem(g[0].replace(/\s+/g, '')); for (const w of g) CANON.set(stem(w.replace(/\s+/g, '')), head); }

/** Signals a model would read from the shape of the text, expressed as extra tokens. */
function syntheticTokens(text) {
  const out = [];
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(text)) out.push('phone', 'personal');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) out.push('email', 'personal');
  if (/\b\d{1,5}\s+\w+\s+(street|st|road|rd|avenue|ave|lane|ln)\b/i.test(text)) out.push('address', 'personal');
  if (/[!?]{2,}/.test(text)) out.push('unclear');
  return out;
}
/** Tokens of any value: canonical stems, stop words removed, PII / punctuation signals added. */
export function tokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const raw = text.toLowerCase().replace(/[^a-z0-9+@.\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  const out = raw.map((w) => { const s = stem(w.replace(/[^a-z0-9]/g, '')); return CANON.get(s) || s; }).filter((t) => t.length > 1);
  for (const t of syntheticTokens(text)) out.push(CANON.get(stem(t)) || stem(t));
  return out;
}
/** Overlap score: for every token in `a` that also occurs in `b`, 1 for the first hit and 0.6 for each further shared occurrence (min of both counts). */
function overlap(a, b) {
  const A = new Map(), B = new Map();
  for (const t of a) A.set(t, (A.get(t) || 0) + 1);
  for (const t of b) B.set(t, (B.get(t) || 0) + 1);
  let s = 0;
  for (const [t, n] of A) if (B.has(t)) s += 1 + 0.6 * (Math.min(n, B.get(t)) - 1);
  return s;
}
function softmax(scores, k = 1.6) {
  const m = Math.max(...scores); const e = scores.map((s) => Math.exp((s - m) * k)); const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}
const round = (x) => Math.round(x * 1000) / 1000;
const textOf = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/** Urgency lexicon for `score` questions: word → position in [-1, 1] across the rubric. */
const INTENSITY = { crash: 1, loss: 1, outage: 1, down: 0.9, security: 1, urgent: 0.9, critical: 1, emergency: 1, blocker: 0.9, fail: 0.6, error: 0.5, silently: 0.3, duplicate: 0.4, twice: 0.4, slow: 0.3, timeout: 0.5, customer: 0.3, lose: 0.8, cannot: 0.5, since: 0.2, minor: -0.9, typo: -0.9, cosmetic: -0.9, polish: -0.8, illustration: -0.6, refresh: -0.5, dark: -0.3, mode: -0.2, nicetohav: -1, someday: -1, marketing: -0.4, calm: -0.9, annoyed: 0.2, angry: 0.9, furious: 1, fine: -0.6, thanks: -0.7 };

function answerChoice(stateTokens, q) {
  const names = Object.keys(q.criteria || {});
  if (!names.length) return { type: 'choice', choice: null, probabilities: {}, confidence: 0 };
  // a criteria value is a description string ("Label: what it does" in Smart Add) or a nested object ({ label, description }): its label counts a little extra
  const scores = names.map((n) => { const c = q.criteria[n]; const label = c && typeof c === 'object' && c.label ? String(c.label) : typeof c === 'string' && /^[^:]{1,40}:\s/.test(c) ? c.slice(0, c.indexOf(':')) : ''; return overlap(stateTokens, tokens(`${n} ${n} ${textOf(c)}`)) + (label ? 0.35 * overlap(stateTokens, tokens(label)) : 0); });
  const p = scores.every((s) => s === 0) ? names.map(() => 1 / names.length) : softmax(scores);
  const order = p.map((v, i) => i).sort((a, b) => p[b] - p[a]);
  const probabilities = Object.fromEntries(names.map((n, i) => [n, round(p[i])]));
  const confidence = round(Math.max(0, p[order[0]] - (p[order[1]] ?? 0)));
  return { type: 'choice', choice: names[order[0]], probabilities, confidence };
}
function answerNoul(stateTokens, q) {
  const c = q.criteria || {};
  const sT = overlap(stateTokens, tokens(textOf(c.true) || 'yes true')), sF = overlap(stateTokens, tokens(textOf(c.false) || 'no false'));
  const p = sT === 0 && sF === 0 ? 0.5 : softmax([sT, sF], 1.2)[0];
  return { type: 'noul', noul: round(p) };
}
function answerScore(stateTokens, q, stateText) {
  const levels = Array.isArray(q.criteria) ? q.criteria.map(textOf) : ['low', 'high'];
  const n = Math.max(2, levels.length);
  // lexicon intensity (what "higher" usually means) blended with overlap against the level descriptions
  const words = stateText.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).map((w) => stem(w)).filter(Boolean);
  let sum = 0, hits = 0;
  for (const w of words) { const key = Object.keys(INTENSITY).find((k) => w.startsWith(stem(k))); if (key !== undefined) { sum += INTENSITY[key]; hits++; } }
  const intensity = hits ? Math.tanh(sum) : 0;
  const lex = (intensity + 1) / 2 * (n - 1);
  const ov = levels.map((l) => overlap(stateTokens, tokens(l)));
  const ovTotal = ov.reduce((a, b) => a + b, 0);
  const ovPos = ovTotal ? ov.reduce((a, s, i) => a + s * i, 0) / ovTotal : null;
  const pos = ovPos === null ? lex : (lex * 0.6 + ovPos * 0.4);
  const sigma = hits || ovTotal ? 0.7 : 1.4;
  const raw = levels.map((_, i) => Math.exp(-((i - pos) ** 2) / (2 * sigma * sigma)));
  const z = raw.reduce((a, b) => a + b, 0); const p = raw.map((x) => x / z);
  const score = p.reduce((a, v, i) => a + v * i, 0);
  const sorted = [...p].sort((a, b) => b - a);
  return { type: 'score', score: round(score), confidence: round(Math.max(0, sorted[0] - (sorted[1] || 0))), probabilities: Object.fromEntries(p.map((v, i) => [String(i), round(v)])), legend: Object.fromEntries(levels.map((l, i) => [String(i), l])) };
}

/** Answer every question against the state, the way the API would. */
export function simulate({ state, questions }) {
  const stateText = typeof state === 'string' ? state : Array.isArray(state) ? state.map(textOf).join('\n') : JSON.stringify(state ?? '');
  const st = tokens(stateText);
  const answers = {};
  for (const [id, q] of Object.entries(questions || {})) {
    const scopedText = q && q.instructions && /Item:\s*"/.test(q.instructions) ? q.instructions.replace(/^[\s\S]*?Item:\s*"/, '').replace(/"\s*$/, '') : null;
    const sTok = scopedText ? tokens(scopedText) : st;
    if (!q || typeof q !== 'object') continue;
    if (q.type === 'choice') answers[id] = answerChoice(sTok, q);
    else if (q.type === 'noul') answers[id] = answerNoul(sTok, q);
    else if (q.type === 'score') answers[id] = answerScore(sTok, q, scopedText || stateText);
  }
  const chars = stateText.length + JSON.stringify(questions || {}).length;
  return { model: 'simulated', answers, usage: { input_tokens: Math.ceil(chars / 4), output_tokens: Object.keys(answers).length * 6 } };
}
/** Simulated round-trip latency (ms), stable per input. */
export function simulatedLatency(seed) { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 90 + (h % 171); }
