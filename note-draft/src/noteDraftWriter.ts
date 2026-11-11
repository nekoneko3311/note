import type { Browser, Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { openAuthedContext } from './noteSession.js';
import { resolveScope, waitForEditorReady, fillTitle, fillBody, applyImageLinks, setThumbnail, saveDraft } from './noteEditorAdapter.js';
import { URLS } from './selectors.js';
import { SCREENSHOTS_DIR } from './paths.js';
import { logger, auditFile } from './logger.js';
import type { RuntimeOptions } from './config.js';
import type { ParsedArticle } from './types.js';

export interface DraftResult {
  ok: boolean;
  draftUrl?: string;
  imagesInserted: number;
  imagesLeftOver?: number;
  linkCards?: number;
  linkCardsFailed?: string[];
  /** リンクを付けた画像の数 */
  imageLinksSet?: number;
  /** リンクを付けられなかった画像のファイル */
  imageLinksFailed?: string[];
  thumbnailSet: boolean;
  saveButtonLabel?: string;
  screenshot?: string;
  error?: string;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function shot(page: Page, name: string): Promise<string> {
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const path = resolve(SCREENSHOTS_DIR, `${stamp()}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

/**
 * 記事を note の「下書き」まで入稿する。
 * 公開ボタンには触れない。最後は必ず下書き保存で止まる。
 */
export async function createDraft(article: ParsedArticle, opts: RuntimeOptions): Promise<DraftResult> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  const folderName = basename(article.dir);
  auditFile({ event: 'draft:start', folder: folderName, title: article.frontmatter.title, bodyChars: article.bodyText.length, images: article.images.length });

  try {
    const opened = await openAuthedContext(opts);
    browser = opened.browser;
    page = opened.page;

    if (!opts.headed) {
      logger.warn('note のエディタは headless では読み込めないことがあります。うまくいかない場合は --headed で実行してください。');
    }

    // 新規投稿画面へ（editor.note.com。開くと自動で下書きが1件作られる）
    await page.goto(URLS.newNote, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // ログイン確認：未ログインなら note は /login へ飛ばす
    if (/\/login|\/signup/.test(page.url())) {
      const s = await shot(page, 'login-check-failed');
      throw new Error('ログイン状態が確認できませんでした。`npm run login` でログインし直してください。screenshot: ' + s);
    }

    // エディタ本体の描画を待つ
    await waitForEditorReady(page);
    const scope = await resolveScope(page);

    await fillTitle(scope, article.frontmatter.title);

    // サムネイル（見出し画像）は本文より先に。上部の入口が一意に取りやすい。
    let thumbnailSet = false;
    if (article.thumbnailAbsPath) {
      thumbnailSet = await setThumbnail(page, article.thumbnailAbsPath);
    }

    const { imagesInserted, imagesLeftOver, linkCards, linkCardsFailed, imageLinks } = await fillBody(page, scope, article, opts.inlineImages);

    // リンク付き画像（`[![alt](画像)](URL)`）にリンクを付ける。本文を打ち終えてから行う
    const { linked: imageLinksSet, failed: imageLinksFailed } = await applyImageLinks(page, imageLinks);

    const beforeSave = await shot(page, 'before-save');
    logger.info({ screenshot: beforeSave }, '下書き保存の直前です（公開ボタンには触れていません）');

    const saveButtonLabel = await saveDraft(page);
    await page.waitForTimeout(2000);

    const draftUrl = page.url();
    const afterSave = await shot(page, 'after-save-draft');

    auditFile({ event: 'draft:done', folder: folderName, draftUrl, imagesInserted, imagesLeftOver, linkCards, linkCardsFailed, imageLinksSet, imageLinksFailed, thumbnailSet, saveButtonLabel });

    // --pause-on-error は失敗したときだけブラウザを残す。成功したら閉じて終わる
    await browser.close();

    return { ok: true, draftUrl, imagesInserted, imagesLeftOver, linkCards, linkCardsFailed, imageLinksSet, imageLinksFailed, thumbnailSet, saveButtonLabel, screenshot: afterSave };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let errShot: string | undefined;
    if (page) {
      try { errShot = await shot(page, 'error'); } catch { /* ページが閉じている等 */ }
    }
    auditFile({ event: 'draft:error', folder: folderName, message, screenshot: errShot });
    logger.error({ err: message, screenshot: errShot }, '下書き作成でエラーが発生しました');
    if (browser && !opts.pauseOnError) await browser.close();
    return { ok: false, imagesInserted: 0, thumbnailSet: false, error: message, screenshot: errShot };
  }
}
