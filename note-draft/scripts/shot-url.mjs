import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const [, , url, out, wArg, hArg, full] = process.argv;
if (!url || !out) { console.error('usage: node scripts/shot-url.mjs <url> <out.png> [w] [h] [full]'); process.exit(1); }
const width = Number(wArg) || 1280, height = Number(hArg) || 760;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...(existsSync(resolve('storage/note-auth.json')) ? { storageState: resolve('storage/note-auth.json') } : {}),
  viewport: { width, height }, deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.screenshot({ path: out, fullPage: full === 'full' });
await browser.close();
console.log(`${out} (${width}x${height} @2x)`);
