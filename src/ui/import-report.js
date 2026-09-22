// ui/import-report.js — what a ComfyUI import did, on the modal shell: "Imported N of M nodes ·
// K placeholders", the skipped classes with their reason, the notes (files to pick, folded
// nodes, assumptions) and a Copy report button. `open(report, { name })` with the report from
// import/comfyui.js → comfyToProto3D.
import { icons } from '../icons.js';
import { Dialog } from './help-dialogs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The report as plain text (the Copy button, tests). */
export function reportText(report, name = '') {
  const built = report.mapped.filter((m) => m.proto.length).length;
  const lines = [`ComfyUI import${name ? ` · ${name}` : ''}`, `Imported ${report.total - report.skipped.length} of ${report.total} nodes · ${report.placeholders} placeholder${report.placeholders === 1 ? '' : 's'} · ${built} became Proto3D components`];
  if (report.skipped.length) { lines.push('', 'Skipped'); for (const s of report.skipped) lines.push(`  ${s.id} ${s.class} · ${s.reason}`); }
  if (report.notes.length) { lines.push('', 'Notes'); for (const n of report.notes) lines.push(`  ${n}`); }
  lines.push('', 'Mapping');
  for (const m of report.mapped) lines.push(`  ${m.comfy} → ${m.proto.length ? m.proto.join(', ') : '—'}${m.how ? ` (${m.how})` : ''}`);
  return lines.join('\n');
}

export class ImportReportDialog extends Dialog {
  constructor({ toast = () => {} } = {}) { super('import-report'); this.toast = toast; this.report = null; this.name = ''; }
  open(report, { name = '' } = {}) { this.report = report; this.name = name; super.open(); }
  render() {
    const r = this.report; if (!r) { this._shell(icons.file, 'Import', 'Nothing imported yet.', ''); return; }
    const built = r.mapped.filter((m) => m.proto.length).length;
    const lead = `Imported <b>${r.total - r.skipped.length}</b> of <b>${r.total}</b> nodes · <b>${r.placeholders}</b> placeholder${r.placeholders === 1 ? '' : 's'} · ${built} became Proto3D components. Loaders, latents and samplers collapsed into Settings and Generate nodes; the rest is listed below.`;
    const skipped = r.skipped.length ? `<section><h3>Skipped (${r.skipped.length})</h3><ul class="import-list">${r.skipped.map((s) => `<li><b>${esc(s.class)}</b> <small>#${esc(s.id)}</small> · ${esc(s.reason)}</li>`).join('')}</ul></section>` : '<section><h3>Skipped</h3><p class="import-none">Every node was mapped.</p></section>';
    const notes = r.notes.length ? `<section><h3>Notes (${r.notes.length})</h3><ul class="import-list">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : '';
    const mapped = `<details class="import-mapping"><summary>Mapping · ${r.mapped.length} rows</summary><ul class="import-list">${r.mapped.map((m) => `<li><b>${esc(m.comfy)}</b> → ${m.proto.length ? esc(m.proto.join(', ')) : '<i>—</i>'}${m.how ? ` <small>${esc(m.how)}</small>` : ''}</li>`).join('')}</ul></details>`;
    this._shell(icons['generate-image'], `ComfyUI workflow imported${this.name ? ` · ${esc(this.name)}` : ''}`, lead, `${skipped}${notes}${mapped}`, `<span>Files from ComfyUI's input folder are not reachable: a sample stands in until you pick the picture on its Media block.</span><span class="grow"></span><button type="button" class="import-copy">Copy report</button>`);
    this.el.querySelector('.import-copy').addEventListener('click', async () => {
      const text = reportText(r, this.name);
      try { await navigator.clipboard.writeText(text); this.toast('Report copied', 1400); }
      catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); this.toast('Report copied', 1400); } catch (__) { this.toast('Could not copy — select the text instead', 2000); } ta.remove(); }
    });
  }
}
