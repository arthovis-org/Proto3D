// ai/jobs.js — the job model and the global queue. A Job is one generation request: it moves
// through queued → running → succeeded | failed | cancelled, carries progress (0..1), a log,
// timings, tokens and cost, and the result. The queue limits how many jobs run at once
// (vault.settings.concurrency, default 3), retries on request, cancels through AbortSignal and
// emits change events for the faces, the panel and the job tray.
import { vault } from './vault.js';
import { ProviderError, isAbort } from './http.js';
import { spend } from './pricing.js';

export const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
let seq = 0;
const jobId = () => `j${Date.now().toString(36).slice(-5)}${(++seq).toString(36)}`;

export class Job {
  /**
   * @param {object} o { provider, kind: 'text'|'image'|'video'|'audio', spec, owner (instance uid), title, estimate (USD), run(job, signal) → result }
   */
  constructor(o) {
    this.id = jobId();
    this.provider = o.provider; this.kind = o.kind; this.spec = o.spec; this.owner = o.owner || null; this.title = o.title || '';
    this.model = o.spec?.model || ''; this.estimate = o.estimate ?? null;
    this.status = 'queued'; this.progress = 0; this.stage = 'queued'; this.queuePosition = null;
    this.logs = []; this.createdAt = Date.now(); this.startedAt = null; this.finishedAt = null;
    this.tokens = null; this.cost = null; this.result = null; this.partial = null; this.error = null;
    this.attempts = 0; this._run = o.run; this._ctrl = null; this._queue = null;
    this._listeners = new Set();
  }
  get elapsed() { return this.startedAt ? ((this.finishedAt || Date.now()) - this.startedAt) / 1000 : 0; }
  get done() { return this.status === 'succeeded' || this.status === 'failed' || this.status === 'cancelled'; }
  get active() { return this.status === 'queued' || this.status === 'running'; }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit(what = 'update') { this._listeners.forEach((cb) => cb(this, what)); this._queue?._emit(what, this); }
  /** Providers report through this: any subset of { progress, stage, queuePosition, log, partial, tokens, cost }. */
  update(u = {}) {
    if (u.progress !== undefined) this.progress = Math.max(this.progress, Math.min(1, u.progress));
    if (u.stage !== undefined) this.stage = u.stage;
    if (u.queuePosition !== undefined) this.queuePosition = u.queuePosition;
    if (u.log) this.logs.push({ t: Date.now(), text: String(u.log) });
    if (u.partial !== undefined) this.partial = u.partial;
    if (u.tokens !== undefined) this.tokens = u.tokens;
    if (u.cost !== undefined) this.cost = u.cost;
    this._emit('progress');
  }
  cancel() {
    if (this.done) return false;
    this.status = 'cancelled'; this.stage = 'cancelled'; this.finishedAt = Date.now();
    this._ctrl?.abort();
    this._emit('cancelled');
    this._queue?._next();
    return true;
  }
  /** Put a failed or cancelled job back in the queue. */
  retry() {
    if (!this.done || this.status === 'succeeded') return false;
    this.status = 'queued'; this.stage = 'queued'; this.progress = 0; this.error = null; this.partial = null; this.finishedAt = null; this.startedAt = null;
    this._emit('retry');
    this._queue?._schedule(this);
    return true;
  }
  async _execute() {
    this.attempts += 1;
    this.status = 'running'; this.stage = 'starting'; this.startedAt = Date.now();
    this._ctrl = new AbortController();
    this._emit('start');
    try {
      const result = await this._run(this, this._ctrl.signal);
      if (this.status === 'cancelled') return;
      this.result = result; this.progress = 1; this.status = 'succeeded'; this.stage = 'done'; this.finishedAt = Date.now();
      if (this.cost === null && result && typeof result.cost === 'number') this.cost = result.cost;
      if (this.cost === null && this.estimate !== null) this.cost = this.estimate;
      if (typeof this.cost === 'number') spend.add(this.provider, this.cost, this.kind);
      this._emit('done');
    } catch (e) {
      if (this.status === 'cancelled' || isAbort(e)) { if (this.status !== 'cancelled') { this.status = 'cancelled'; this.stage = 'cancelled'; this.finishedAt = Date.now(); this._emit('cancelled'); } return; }
      this.error = e instanceof ProviderError ? { code: e.code, message: e.message, fix: e.fix } : { code: 'error', message: e?.message || String(e), fix: null };
      this.status = 'failed'; this.stage = 'failed'; this.finishedAt = Date.now();
      this.update({ log: `error: ${this.error.message}` });
      this._emit('failed');
    } finally {
      this._ctrl = null;
      this._queue?._next();
    }
  }
  toJSON() {
    return { id: this.id, provider: this.provider, kind: this.kind, model: this.model, title: this.title, status: this.status, progress: this.progress, stage: this.stage, queuePosition: this.queuePosition, startedAt: this.startedAt, finishedAt: this.finishedAt, elapsed: +this.elapsed.toFixed(1), tokens: this.tokens, cost: this.cost, error: this.error, logs: this.logs.length };
  }
}

class JobQueue {
  constructor() { this.jobs = []; this.pending = []; this._listeners = new Set(); this.keep = 40; }
  get concurrency() { return Math.max(1, +vault.settings.concurrency || 3); }
  get running() { return this.jobs.filter((j) => j.status === 'running'); }
  get active() { return this.jobs.filter((j) => j.active); }
  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit(what, job) { this._listeners.forEach((cb) => cb(what, job, this)); }
  /** Create and enqueue a job. */
  create(o) {
    const job = new Job(o);
    job._queue = this;
    this.jobs.push(job);
    // keep the list short: drop the oldest finished jobs
    const finished = this.jobs.filter((j) => j.done);
    if (finished.length > this.keep) for (const j of finished.slice(0, finished.length - this.keep)) this.jobs.splice(this.jobs.indexOf(j), 1);
    this._emit('create', job);
    this._schedule(job);
    return job;
  }
  _schedule(job) { if (!this.pending.includes(job)) this.pending.push(job); this._next(); }
  _next() {
    while (this.pending.length && this.running.length < this.concurrency) {
      const job = this.pending.shift();
      if (job.status !== 'queued') continue;
      job._execute();
    }
    this.pending.forEach((j, i) => { if (j.queuePosition !== i + 1) { j.queuePosition = i + 1; j._emit('progress'); } });
  }
  byId(id) { return this.jobs.find((j) => j.id === id) || null; }
  forOwner(uid) { return this.jobs.filter((j) => j.owner === uid); }
  cancelAll() { this.jobs.filter((j) => j.active).forEach((j) => j.cancel()); }
  clearFinished() { this.jobs = this.jobs.filter((j) => !j.done); this._emit('clear', null); }
}
export const jobs = new JobQueue();
export default jobs;

/** Short human elapsed time: 0.8 s · 12 s · 1:04. */
export function fmtElapsed(s) { if (!Number.isFinite(s)) return ''; if (s < 10) return `${s.toFixed(1)} s`; if (s < 60) return `${Math.round(s)} s`; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; }
