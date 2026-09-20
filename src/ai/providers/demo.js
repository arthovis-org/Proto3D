// ai/providers/demo.js — the offline provider, always available and clearly labelled DEMO. It
// makes no network calls and costs nothing: text streams word by word (a plausible paragraph
// built from the prompt's own words), images and video posters are painted on a canvas from
// a hash of the prompt, audio is a short generated melody as a WAV blob. Its job is to let the
// Showcase run without keys and to let people design a flow before they connect a real service.
import { registerProvider } from './base.js';
import { sleep } from '../http.js';

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const words = (prompt) => String(prompt || '').replace(/\{[^}]*\}/g, '').split(/[^\p{L}\p{N}'-]+/u).filter((w) => w.length > 2).slice(0, 40);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A paragraph that reads like an answer to the prompt: its nouns come back in template sentences. */
const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'that', 'this', 'from', 'into', 'your', 'our', 'one', 'two', 'write', 'short', 'upbeat', 'launch', 'tweet', 'sentence', 'emoji', 'hashtags', 'please', 'make', 'create', 'generate']);
/** The thing the prompt is about: what follows "for / about / on", else the capitalised words, else the first content words. */
function subjectOf(prompt) {
  const first = String(prompt || '').replace(/\{[^}]*\}/g, '').split(/[.!?\n:]/)[0] || '';
  const m = /\b(?:for|about|on|of)\s+(.+)$/i.exec(first);
  const tail = (m ? m[1] : '').replace(/[,;].*$/, '').trim();
  if (tail) return tail.split(/\s+/).slice(0, 5).join(' ');
  const caps = words(first).filter((w) => /^[A-Z]/.test(w) && !STOP.has(w.toLowerCase()));
  if (caps.length) return caps.slice(0, 4).join(' ');
  const content = words(first).filter((w) => !STOP.has(w.toLowerCase()));
  return content.slice(0, 3).join(' ') || 'your idea';
}
function composeText(prompt, { json = false, system = '' } = {}) {
  const ws = words(prompt).filter((w) => !STOP.has(w.toLowerCase())); const r = rng(hash(prompt + system));
  const pick = () => ws.length ? ws[Math.floor(r() * ws.length)].toLowerCase() : 'this';
  const subject = subjectOf(prompt);
  const tweetish = /tweet|post|announce|headline|caption|slogan/i.test(prompt);
  if (json) return JSON.stringify({ headline: `${cap(subject)} is here`, summary: `A short, confident line about ${subject} written by the Demo provider.`, hashtags: ws.slice(0, 3).map((w) => '#' + w.replace(/\W/g, '')), tone: 'demo', words: ws.length }, null, 2);
  if (tweetish) { const tags = [...new Set(subject.split(/\s+/).map((w) => w.replace(/\W/g, '')).filter((w) => w.length > 2))].slice(0, 2); return `${cap(subject)} is live — faster, calmer, and built around what you asked for. Take a look today. #${tags[0] || 'launch'} #${tags[1] || 'demo'}`; }
  const T = [
    `${cap(subject)} comes down to ${pick()} and ${pick()}.`, `Start with ${pick()}: it sets the tone for everything that follows.`,
    `The ${pick()} matters more than it looks, so keep it simple and visible.`, `When ${pick()} and ${pick()} agree, the rest falls into place.`,
    `A good rule: measure ${pick()} before changing ${pick()}.`, `In short, ${subject} works best when ${pick()} stays in view.`,
  ];
  const n = 3 + Math.floor(r() * 3);
  const out = []; for (let i = 0; i < n; i++) out.push(T[(i + Math.floor(r() * 2)) % T.length]);
  return `(Demo) ${out.join(' ')}`;
}

/** A 640 × 400 "key visual": gradient, motif and the prompt's words, from a hash of the prompt. */
function paintImage(prompt, { w = 640, h = 400, video = false, seed } = {}) {
  const r = rng(hash(prompt) ^ (seed || 0));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const hue = Math.floor(r() * 360), hue2 = (hue + 40 + Math.floor(r() * 80)) % 360;
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, `hsl(${hue} 70% 55%)`); grad.addColorStop(1, `hsl(${hue2} 60% 25%)`);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.14)';
  const motif = Math.floor(r() * 4);
  for (let i = 0; i < 7; i++) {
    const x = r() * w, y = r() * h, s = 40 + r() * 160;
    g.beginPath();
    if (motif === 0) g.arc(x, y, s / 2, 0, Math.PI * 2);
    else if (motif === 1) g.rect(x - s / 2, y - s / 4, s, s / 2);
    else if (motif === 2) { g.moveTo(x, y - s / 2); g.lineTo(x + s / 2, y + s / 2); g.lineTo(x - s / 2, y + s / 2); g.closePath(); }
    else { g.ellipse(x, y, s / 2, s / 5, r() * Math.PI, 0, Math.PI * 2); }
    g.fill();
  }
  // soft vignette + caption
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  const ws = words(prompt).slice(0, 4).map(cap).join(' ') || 'Untitled';
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = '600 34px Inter, system-ui, sans-serif'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillText(ws.length > 28 ? ws.slice(0, 27) + '…' : ws, 32, h - 44);
  g.font = '500 14px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText(`DEMO · ${video ? 'video poster' : 'generated image'} · ${w}×${h}`, 32, h - 20);
  return c;
}
const toBlob = (canvas, type = 'image/png') => new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.92));

/** A ~4 s melody as a 16-bit mono WAV blob; notes follow the prompt hash. */
function makeMelody(prompt, seconds = 4, rate = 22050) {
  const r = rng(hash(prompt)); const n = Math.floor(seconds * rate);
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const notes = Array.from({ length: 8 }, () => 220 * Math.pow(2, scale[Math.floor(r() * scale.length)] / 12));
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const per = n / notes.length;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / per), t = i / rate, ph = (i % per) / per;
    const env = Math.min(1, ph * 12) * Math.exp(-ph * 3);
    const f = notes[k];
    const s = env * (0.5 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t) + 0.12 * Math.sin(2 * Math.PI * f * 3 * t));
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * 0.8)) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const DEMO_MODELS = [
  { id: 'demo/writer', label: 'Demo writer', kind: 'text', recommended: true, pricing: { prompt: 0, completion: 0 }, context: 8000, vision: true, json: true, note: 'streams a paragraph built from your prompt' },
  { id: 'demo/painter', label: 'Demo painter', kind: 'image', recommended: true, pricing: { run: 0, text: 'free' }, params: [{ key: 'size', label: 'size', type: 'select', options: ['640×400', '512×512', '400×640'], default: '640×400' }], note: 'paints a key visual from your prompt' },
  { id: 'demo/director', label: 'Demo director', kind: 'video', recommended: true, pricing: { run: 0, text: 'free' }, params: [{ key: 'duration', label: 'duration (s)', type: 'number', default: 8, min: 2, max: 30, step: 1 }], note: 'an animated poster (no real playback)' },
  { id: 'demo/composer', label: 'Demo composer', kind: 'audio', recommended: true, pricing: { run: 0, text: 'free' }, params: [{ key: 'seconds', label: 'length (s)', type: 'number', default: 4, min: 1, max: 12, step: 1 }], note: 'a short generated melody (WAV)' },
];

export const demo = registerProvider({
  id: 'demo', label: 'Demo', url: '', keyUrl: '',
  description: 'Runs offline, costs nothing, needs no key. Text, images, video posters and audio are generated in the browser so you can build and test a flow before connecting a real service.',
  glyph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.6 1.6 1.6.6-1.6.6L19 21.4l-.6-1.6-1.6-.6 1.6-.6z"/></svg>',
  capabilities: ['text', 'vision', 'json', 'image', 'video', 'audio'], needsKey: false, keyHint: '', corsNote: '',
  models: DEMO_MODELS,
  defaultModel: { text: 'demo/writer', image: 'demo/painter', video: 'demo/director', audio: 'demo/composer' },
  async testKey() { return { ok: true, latencyMs: 0, balance: null, message: 'always available · no key · no cost' }; },
  async listModels({ kind } = {}) { return DEMO_MODELS.filter((m) => !kind || m.kind === kind).map((m) => ({ ...m, provider: 'demo' })); },
  modelInfo(id) { const m = DEMO_MODELS.find((x) => x.id === id); return m ? { ...m, provider: 'demo' } : null; },
  estimateCost() { return 0; },

  async run(spec, job, { signal }) {
    const fast = !!spec.fast;   // tests can ask for near-instant output
    if (spec.kind === 'text') {
      job.update({ stage: 'thinking', progress: 0.05 });
      await sleep(fast ? 10 : 350 + Math.random() * 300, signal);
      const full = composeText(spec.prompt, { json: !!spec.json, system: spec.system });
      const toks = full.split(/(?<=\s)/);
      let text = '';
      job.update({ stage: 'streaming', progress: 0.1 });
      for (let i = 0; i < toks.length; i++) {
        text += toks[i];
        job.update({ partial: text, progress: 0.1 + 0.85 * (i + 1) / toks.length });
        await sleep(fast ? 1 : 28 + Math.random() * 40, signal);
      }
      const usage = { prompt_tokens: Math.ceil(String(spec.prompt || '').length / 4) + Math.ceil(String(spec.system || '').length / 4), completion_tokens: toks.length };
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      let data; if (spec.json) { try { data = JSON.parse(full); } catch (_) { /* n/a */ } }
      job.update({ tokens: { in: usage.prompt_tokens, out: usage.completion_tokens }, cost: 0, log: `${usage.prompt_tokens} in · ${usage.completion_tokens} out` });
      return { text: full, data, usage, cost: 0, model: spec.model, finish: 'stop' };
    }
    // media: a short simulated queue, then a progress ramp, then the blob
    job.update({ stage: 'queued', queuePosition: 1, progress: 0.05, log: 'demo queue' });
    await sleep(fast ? 10 : 400, signal);
    const steps = fast ? 2 : spec.kind === 'image' ? 10 : 18;
    for (let i = 1; i <= steps; i++) { job.update({ stage: 'generating', queuePosition: null, progress: 0.1 + 0.8 * i / steps, log: i === 1 ? 'generating…' : undefined }); await sleep(fast ? 1 : 90, signal); }
    const title = words(spec.prompt).slice(0, 3).map(cap).join(' ') || 'Demo';
    const count = spec.kind === 'image' ? Math.max(1, Math.min(4, spec.count || 1)) : 1;
    const media = [];
    if (spec.kind === 'image' || spec.kind === 'video') {
      const [w, h] = String(spec.options?.size || '640×400').split('×').map((n) => +n || 400);
      for (let i = 0; i < count; i++) {
        const c = paintImage(spec.prompt, { w, h, video: spec.kind === 'video', seed: (spec.seed ?? 0) + i * 7919 });
        const blob = await toBlob(c);
        media.push({ kind: spec.kind, blob, w, h, title: count > 1 ? `${title} ${i + 1}` : title, duration: spec.kind === 'video' ? +spec.options?.duration || 8 : undefined });
      }
    } else {
      const seconds = +spec.options?.seconds || 4;
      media.push({ kind: 'audio', blob: makeMelody(spec.prompt, seconds), title, duration: seconds });
    }
    job.update({ progress: 0.95, log: 'done', cost: 0 });
    return { media, cost: 0 };
  },
});
export default demo;
