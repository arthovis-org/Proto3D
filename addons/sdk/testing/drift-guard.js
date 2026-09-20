// sdk/testing/drift-guard.js — the isolation rule, enforced: add-on code may import only from
// `addons/sdk/**` and its own files, never from the core (`src/**`, `index.html`, `styles.css`).
// Walks every add-on directory (anything under addons/ except sdk/ and node_modules/), reads
// .js / .mjs / .html / .css files and resolves every static import, dynamic import(), re-export,
// <script src>, <link href> and CSS @import against the file's location. A specifier that lands
// inside the repo's `src/` (or on the core page / stylesheet), or a bare "/src/…" path, is a
// violation. Run as a test (drift-guard.test.js) or from the CLI: `node drift-guard.js`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const ADDONS_DIR = path.join(REPO_ROOT, 'addons');
const SKIP_DIRS = new Set(['sdk', 'node_modules', '.git', 'test-results']);
const EXT = new Set(['.js', '.mjs', '.html', '.css']);

const PATTERNS = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,          // import x from '…' / import '…'
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,       // export … from '…'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,                        // import('…')
  /<script[^>]*\ssrc\s*=\s*['"]([^'"]+)['"]/g,                     // <script src>
  /<link[^>]*\shref\s*=\s*['"]([^'"]+)['"]/g,                      // <link href>
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g,                         // css @import
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); continue; }
    if (EXT.has(path.extname(e.name))) out.push(path.join(dir, e.name));
  }
  return out;
}

/** Is `spec` (relative to `file`) pointing into the core? Returns a reason string or null. */
export function classify(spec, file, repoRoot = REPO_ROOT) {
  if (/^(https?:)?\/\//.test(spec) || /^(data|blob):/.test(spec)) return null;      // URLs are not core files
  if (spec.startsWith('/src/') || spec === '/index.html' || spec === '/styles.css') return `absolute core path "${spec}"`;
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;                  // bare specifier (three, …): the import map's business
  const target = spec.startsWith('/') ? path.join(repoRoot, spec) : path.resolve(path.dirname(file), spec);
  const rel = path.relative(repoRoot, target);
  if (rel === 'src' || rel.startsWith(`src${path.sep}`)) return `resolves into core: ${rel}`;
  if (rel === 'index.html' || rel === 'styles.css') return `resolves to the core page: ${rel}`;
  if (rel.startsWith('..')) return `escapes the repository: ${spec}`;
  return null;
}

/** All violations under `addonsDir`: [{ file, line, spec, reason }]. */
export function scanAddons(addonsDir = ADDONS_DIR, repoRoot = REPO_ROOT) {
  const out = [];
  if (!fs.existsSync(addonsDir)) return out;
  for (const file of walk(addonsDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let mm;
      while ((mm = re.exec(text))) {
        const reason = classify(mm[1], file, repoRoot);
        if (reason) out.push({ file: path.relative(repoRoot, file), line: text.slice(0, mm.index).split('\n').length, spec: mm[1], reason });
      }
    }
  }
  // a CSS @import is matched by two patterns: report each (file, line, spec) once
  const seen = new Set();
  return out.filter((v) => { const k = `${v.file}:${v.line}:${v.spec}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function formatViolations(v) { return v.map((x) => `  ${x.file}:${x.line}  "${x.spec}"  — ${x.reason}`).join('\n'); }

/** Throws with every violation listed. */
export function assertNoDrift(addonsDir = ADDONS_DIR, repoRoot = REPO_ROOT) {
  const v = scanAddons(addonsDir, repoRoot);
  if (v.length) throw new Error(`drift guard: ${v.length} add-on file(s) reach into the core. Add-ons may import only from addons/sdk/** and their own directory.\n${formatViolations(v)}`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = scanAddons();
  if (v.length) { console.error(`drift guard: ${v.length} violation(s)\n${formatViolations(v)}`); process.exit(1); }
  console.log('drift guard: no add-on imports core files');
}
