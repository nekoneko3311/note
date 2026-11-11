import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
// usage: node scripts/annotate-side.mjs <in.png> <out.png> <w> <h> '<JSON items>' [margin]
// items: [{y, h, label}]  ... 左の余白にラベル、画像側に赤い縦バー
// 追加で {box:true, x, w} を渡すと、その範囲を赤枠で囲む
const [, , inPath, outPath, wArg, hArg, itemsJson, marginArg] = process.argv;
const W = Number(wArg), H = Number(hArg);
const M = Number(marginArg) || 250;
const items = JSON.parse(itemsJson || '[]');
const b64 = readFileSync(resolve(inPath)).toString('base64');
const RED = '#E5252A';
const parts = items.map(it => {
  const bar = `<div style="position:absolute;left:${M - 18}px;top:${it.y}px;width:7px;height:${it.h}px;background:${RED};border-radius:4px"></div>`;
  const label = `<div style="position:absolute;left:14px;top:${it.y + 2}px;width:${M - 44}px;color:${RED};font:700 21px/1.45 'Hiragino Sans','Noto Sans JP',sans-serif;text-align:right">${it.label}</div>`;
  if (it.mask) {
    return `<div style="position:absolute;left:${M + it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;background:#DDE1E6;border-radius:4px"></div>`;
  }
  const box = it.box
    ? `<div style="position:absolute;left:${M + it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;border:4px solid ${RED};border-radius:8px;box-sizing:border-box"></div>`
    : '';
  return bar + label + box;
}).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${W + M}px;height:${H}px}body{position:relative;background:#fff}img{position:absolute;left:${M}px;top:0;width:${W}px;height:${H}px;display:block}</style></head><body><img src="data:image/png;base64,${b64}">${parts}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W + M, height: H }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: outPath });
await browser.close();
console.log(`${outPath} (${W + M}x${H} @2x)`);
