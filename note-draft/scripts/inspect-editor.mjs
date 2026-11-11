import { chromium } from 'playwright';
import { resolve } from 'node:path';

const AUTH = resolve('storage/note-auth.json');
const headless = process.env.HEADLESS === '1';
const browser = await chromium.launch({ headless });
const context = await browser.newContext({ storageState: AUTH });
const page = await context.newPage();
await page.goto('https://editor.note.com/new', { waitUntil: 'domcontentloaded' });

// エディタ本体（contenteditable か textarea）が出るまで最大40秒待つ
try {
  await page.waitForSelector('div[contenteditable="true"], textarea', { timeout: 40000 });
  console.log('editor element appeared');
} catch {
  console.log('!! 40秒待っても editor要素が出ませんでした');
}
await page.waitForTimeout(2000);
console.log('URL:', page.url());

const pickAll = () => {
  const pick = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    placeholder: el.getAttribute('placeholder') || '',
    ariaLabel: el.getAttribute('aria-label') || '',
    role: el.getAttribute('role') || '',
    dataTestid: el.getAttribute('data-testid') || '',
    contenteditable: el.getAttribute('contenteditable') || '',
  });
  const q = (sel) => Array.from(document.querySelectorAll(sel)).map(pick);
  return {
    textareas: q('textarea'),
    editables: q('[contenteditable="true"]'),
    textboxes: q('[role="textbox"]'),
    fileInputs: q('input[type="file"]'),
    buttons: Array.from(document.querySelectorAll('button')).map((b) => ({
      text: (b.textContent || '').trim().slice(0, 24),
      ariaLabel: b.getAttribute('aria-label') || '',
      dataTestid: b.getAttribute('data-testid') || '',
    })).filter((b) => b.text || b.ariaLabel || b.dataTestid).slice(0, 50),
  };
};

// メインフレーム
const main = await page.evaluate(pickAll);
console.log('== main frame ==');
console.log(JSON.stringify(main, null, 2));

// iframe 一覧と各フレームの中身
const frames = page.frames();
console.log('== frames count:', frames.length, '==');
for (const f of frames) {
  if (f === page.mainFrame()) continue;
  console.log('-- frame url:', f.url());
  try {
    const inner = await f.evaluate(pickAll);
    console.log(JSON.stringify(inner, null, 2));
  } catch (e) {
    console.log('  (evaluate失敗)', String(e).slice(0, 80));
  }
}

await page.screenshot({ path: 'screenshots/inspect-editor.png', fullPage: false });
await browser.close();
