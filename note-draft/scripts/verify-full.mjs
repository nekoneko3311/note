import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
// usage: node scripts/verify-full.mjs <下書きURL>
// 本文の並びを、ブロックの種類つきで1行ずつ出す。最後に数をまとめる。
// 画面写しは、記事の上から下まで1画面ずつ screenshots/verify-full-<日時>/01.png, 02.png … に保存する。
// 1枚に全ページを撮る方法だと、長い記事で前半がくり返し写り、後半が写らなかった（2026-10-12に実機で確認）。
const url = process.argv[2];
if (!url) { console.error('usage: node scripts/verify-full.mjs <下書きURL>'); process.exit(1); }
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: resolve('storage/note-auth.json'), viewport: { width: 1000, height: 1400 } });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea[placeholder="記事タイトル"]', { timeout: 45000 });
await page.waitForTimeout(2500);
const { rows, sum } = await page.evaluate(() => {
  const editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
  const sum = { 見出し: 0, 画像: 0, 画像のリンク: 0, リンクカード: 0, 箇条書き: 0, 番号リスト: 0, 番号リストの項目: 0, 文中のリンク: 0, コード: 0 };
  const short = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 60);
  const rows = [];
  for (const el of editor.children) {
    const tag = el.tagName;
    if (tag === 'H2' || tag === 'H3') { sum.見出し++; rows.push(`[見出し] ${short(el.innerText)}`); }
    else if (tag === 'FIGURE' && el.getAttribute('embedded-service')) { sum.リンクカード++; rows.push(`[リンクカード] ${el.getAttribute('data-src') || ''}`); }
    else if (tag === 'FIGURE') {
      sum.画像++;
      const href = el.querySelector('a[href]')?.getAttribute('href');
      if (href) { sum.画像のリンク++; rows.push(`[画像→リンク] ${href}`); }
      else rows.push('[画像]');
      continue;
    }
    else if (tag === 'OL') { sum.番号リスト++; sum.番号リストの項目 += el.children.length; rows.push(`[番号リスト ${el.children.length}項目] ${short(el.innerText)}`); }
    else if (tag === 'UL') { sum.箇条書き++; rows.push(`[箇条書き ${el.children.length}項目] ${short(el.innerText)}`); }
    else if (tag === 'PRE') { sum.コード++; rows.push(`[コード] ${short(el.innerText)}`); }
    else { const t = short(el.innerText || ''); if (t) rows.push(t); }
    sum.文中のリンク += el.querySelectorAll('a[href]').length;
  }
  return { rows, sum };
});
console.log(rows.join('\n'));
console.log('\n== まとめ ==');
for (const [k, v] of Object.entries(sum)) console.log(`${k}: ${v}`);

// 画面写し：1枚目は記事の上部（タイトル・見出し画像）。そのあと、画面の下にはみ出したブロックの
// 1つ前を画面の上端に合わせて、1画面ずつ下へ進む（1ブロックずつ重ねて、撮り漏れを防ぐ）
const dir = `screenshots/verify-full-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(dir, { recursive: true });
let n = 1;
await page.screenshot({ path: `${dir}/01.png` });
let from = await page.evaluate(() => {
  const kids = [...document.querySelector('div[contenteditable="true"][role="textbox"]').children];
  const i = kids.findIndex((k) => k.getBoundingClientRect().bottom > window.innerHeight);
  return i < 0 ? -1 : Math.max(i - 1, 0);
});
while (from >= 0 && n < 99) {
  const next = await page.evaluate((i) => {
    const kids = [...document.querySelector('div[contenteditable="true"][role="textbox"]').children];
    kids[i].scrollIntoView({ block: 'start', behavior: 'instant' });
    for (let j = i + 1; j < kids.length; j++) {
      if (kids[j].getBoundingClientRect().bottom > window.innerHeight) return Math.max(j - 1, i + 1);
    }
    return -1;
  }, from);
  await page.waitForTimeout(600);
  n++;
  await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}.png` });
  from = next;
}
console.log(`\n画面写し（上から順に${n}枚）: ${dir}/`);
await browser.close();
