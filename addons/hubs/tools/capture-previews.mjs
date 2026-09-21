// tools/capture-previews.mjs — static preview images for every page in src/clients.js: the base
// layer a hub-page face draws so the screen always shows page content, at any zoom or angle,
// with or without a live iframe. Visits each page at its device viewport (desktop 1280 × 1080,
// tablet 1024 × 1100, phone 390 × 844) in Chromium, waits for network idle plus a short settle
// and saves a JPEG (~800 px wide, phone 390) under assets/previews/<slug>/<page-id>.jpg.
//   node addons/hubs/tools/capture-previews.mjs [slug …] [--missing]   (all clients when no slug is given; --missing skips pages that already have an image)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { CLIENTS, pagesOf, pageId } from '../src/clients.js';

const OUT = path.resolve(new URL('../assets/previews/', import.meta.url).pathname);
const VIEWPORTS = { desktop: { width: 1280, height: 1080, scale: 800 / 1280 }, tablet: { width: 1024, height: 1100, scale: 800 / 1024 }, phone: { width: 390, height: 844, scale: 1 } };
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const missingOnly = process.argv.includes('--missing');
const clients = only.length ? CLIENTS.filter((c) => only.includes(c.slug)) : CLIENTS;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'], timeout: 60000 });
let total = 0, failed = 0;
try {
  for (const [device, vp] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale, ignoreHTTPSErrors: true });   // no mobile emulation: the hubs render their phone shell from the viewport width alone
    for (const c of clients) {
      for (const p of pagesOf(c)) {
        const kind = p.device === 'phone' ? 'phone' : p.device === 'tablet' ? 'tablet' : 'desktop';
        if (kind !== device) continue;
        const file = path.join(OUT, c.slug, `${pageId(p.route)}.jpg`);
        if (missingOnly && fs.existsSync(file)) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const page = await ctx.newPage();   // a fresh page per url: a hash route never rides on the previous document
        try {
          // rendered = content in the DOM and at least one stylesheet with rules (a page whose CSS the flaky network dropped is not a preview)
          const rendered = () => page.evaluate(() => ((document.querySelector('#root')?.children.length || 0) > 0 || document.body.innerText.trim().length > 80) && [...document.styleSheets].some((sh) => { try { return sh.cssRules.length > 0; } catch (_) { return true; } })).catch(() => false);
          for (let attempt = 0; attempt < 2; attempt++) {   // hard per-page budget: ~20 s navigation, 15 s for content, 3 s settle
            try { await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (e) { if (!/interrupted|ERR_ABORTED|Timeout/.test(e.message)) throw e; await page.waitForTimeout(1500); }   // a SPA redirect interrupts the first navigation: the document is there anyway
            await page.waitForFunction(() => (document.querySelector('#root')?.children.length || 0) > 0 || document.body.innerText.trim().length > 80, null, { timeout: 15000 }).catch(() => {});   // the SPA bundle can be slow: wait for content, not just for load
            await page.waitForTimeout(3000);
            if (await rendered()) break;
          }
          if (!(await rendered())) throw new Error('page stayed blank');
          await page.screenshot({ path: file, type: 'jpeg', quality: 78, fullPage: false });
          total += fs.statSync(file).size;
          console.log(`${c.slug}/${pageId(p.route)}.jpg  ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
        } catch (e) { failed++; console.error(`FAILED ${p.url}: ${e.message.split('\n')[0]}`); }
        finally { await page.close().catch(() => {}); }
      }
    }
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB, ${failed} failed`);
process.exit(failed ? 1 : 0);
