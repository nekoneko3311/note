import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
// usage: node scripts/annotate.mjs <in.png> <out.png> <w> <h> '<JSON items>'
// items: [{x, y, w, h, label}]            … 赤枠（labelは枠の上に出る）
//        [{arrow:true, x1, y1, x2, y2, label}] … 赤い矢印（x1,y1から x2,y2 へ。labelは根元に出る）
const [, , inPath, outPath, wArg, hArg, boxesJson] = process.argv;
const W = Number(wArg), H = Number(hArg);
const items = JSON.parse(boxesJson || '[]');
const boxes = items.filter(b => !b.arrow);
const arrows = items.filter(b => b.arrow);
const b64 = readFileSync(resolve(inPath)).toString('base64');
const RED = '#E5252A';
const arrowSvg = arrows.length
  ? `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0"><defs><marker id="ah" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${RED}"/></marker></defs>` +
    arrows.map(a => `<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${RED}" stroke-width="8" stroke-linecap="round" marker-end="url(#ah)"/>`).join('') +
    `</svg>`
  : '';
const arrowLabels = arrows.map(a => a.label
  ? `<div style="position:absolute;left:${a.x1}px;top:${a.y1 - 52}px;transform:translateX(-50%);background:${RED};color:#fff;font:700 22px/1.4 'Hiragino Sans',sans-serif;padding:6px 14px;border-radius:8px;white-space:nowrap">${a.label}</div>`
  : '').join('');
const shapes = boxes.map(b => {
  const label = b.label ? `<div style="position:absolute;left:${b.x}px;top:${b.y - 40}px;background:#E5252A;color:#fff;font:700 22px/1.4 'Hiragino Sans',sans-serif;padding:6px 14px;border-radius:8px;white-space:nowrap">${b.label}</div>` : '';
  return `<div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:5px solid #E5252A;border-radius:10px;box-sizing:border-box"></div>${label}`;
}).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px}body{position:relative}img{width:${W}px;height:${H}px;display:block}</style></head><body><img src="data:image/png;base64,${b64}">${arrowSvg}${shapes}${arrowLabels}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: outPath });
await browser.close();
console.log(`${outPath} (${W}x${H} @2x)`);
