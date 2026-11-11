import type { Page, Locator, FrameLocator } from 'playwright';
import {
  editorScope,
  titleCandidates,
  bodyCandidates,
  saveDraftCandidates,
  imageLinkButtonCandidates,
  imageLinkUrlFieldCandidates,
  imageLinkApplyCandidates,
} from './selectors.js';
import type { BodyLine, ParsedArticle } from './types.js';
import { logger } from './logger.js';

/** 候補ロケータを順に試し、最初に「見えている」ものを返す */
async function firstVisible(cands: Locator[], timeout = 2500): Promise<Locator | null> {
  for (const loc of cands) {
    try {
      const el = loc.first();
      if (await el.isVisible({ timeout })) return el;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

/** エディタ本体（タイトル/本文）が描画されるまで待つ。note編集画面はSPAで数秒かかる */
export async function waitForEditorReady(page: Page): Promise<void> {
  await page.waitForSelector('textarea[placeholder="記事タイトル"], div[contenteditable="true"][role="textbox"]', {
    timeout: 45000,
  });
  await page.waitForTimeout(1200);
}

/** エディタの起点（本体 or iframe）のうち、本文欄が見つかるものを選ぶ。note編集はiframe無しの想定 */
async function resolveScope(page: Page): Promise<Page | FrameLocator> {
  for (const scope of editorScope(page)) {
    const body = await firstVisible(bodyCandidates(scope), 1500);
    if (body) return scope;
  }
  return page;
}

export async function fillTitle(scope: Page | FrameLocator, title: string): Promise<void> {
  const el = await firstVisible(titleCandidates(scope));
  if (!el) throw new Error('タイトル入力欄が見つかりませんでした（selectors.ts の titleCandidates を確認）');
  await el.click();
  await el.fill(title);
  logger.info({ step: 'title', chars: title.length }, 'タイトルを入力しました');
}

export interface FillBodyResult {
  imagesInserted: number;
  /** 本文の位置に置けず、末尾に回した画像の数 */
  imagesLeftOver: number;
  linkCards: number;
  /** リンクカードにならなかったURL */
  linkCardsFailed: string[];
  /** リンク付き画像。本文を入れ終えてから applyImageLinks で付ける */
  imageLinks: ImageLinkRequest[];
}

/** リンクを付ける画像（本文の画像の何枚目か・URL） */
export interface ImageLinkRequest {
  index: number;
  url: string;
  absPath: string;
}

/** 直前に作ったブロックの種類。次のブロックへ移るときのEnter回数がこれで変わる */
type PrevKind = BodyLine['kind'] | 'linkcard' | null;

/**
 * 次のブロックへ移る。noteエディタの実測ルールに従う。
 * - 段落・リスト・引用からは Enter 2回（1回はブロック内の改行にしかならない）
 * - 見出しの直後と画像の直後は Enter 1回
 * - コードブロックの中は Enter 2回で外へ抜ける
 * - リンクカードの直後は、すでに空のブロックにいるので Enter しない
 * 同じ種類のリスト・引用が続くときだけ Enter 1回。戻り値 true はマーカーを打たなくてよい合図。
 */
async function moveToNextBlock(page: Page, prev: PrevKind, current: BodyLine['kind']): Promise<boolean> {
  if (prev === null || prev === 'linkcard') return false;
  const sameList =
    (prev === 'bullet' && current === 'bullet') ||
    (prev === 'ordered' && current === 'ordered') ||
    (prev === 'quote' && current === 'quote');
  if (sameList) {
    await page.keyboard.press('Enter');
    return true;
  }
  await page.keyboard.press('Enter');
  if (prev !== 'heading' && prev !== 'image') await page.keyboard.press('Enter');

  // リスト・引用から出るときは、本当に抜けられたかDOMで確かめる。
  // Enter 2回で抜けきれないことがあり、抜け損ねると以降が全部リストに巻き込まれる
  // （2026-08-25に実機で確認：STEP2の目次リストで発生）。
  if (prev === 'bullet' || prev === 'ordered' || prev === 'quote') {
    for (let i = 0; i < 3; i++) {
      const stillInList = await page.evaluate(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        let node: Node | null = sel.getRangeAt(0).startContainer;
        while (node && node !== document.body) {
          if (node.nodeType === 1) {
            const tag = (node as Element).tagName;
            if (tag === 'LI' || tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE') return true;
            if ((node as Element).getAttribute('contenteditable') === 'true') return false;
          }
          node = node.parentNode;
        }
        return false;
      });
      if (!stillInList) break;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
    }
  }
  return false;
}

/**
 * インライン記法を打つ。
 * 太字は閉じ ** の次の文字を打った瞬間に変換されるので、行末が ** で終わるときは半角スペースを1つ足す。
 * インラインコードは note に変換規則が無いのでバッククォートを外す。リンクはテキストだけ残す。
 * 行末で終わるURLも、次に文字が来ないとリンクにならないので半角スペースを1つ足す（2026-10-03に実機で確認）。
 */
async function typeInline(page: Page, text: string): Promise<void> {
  let t = text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
  if (/\*\*\s*$/.test(t) || /https?:\/\/\S+$/.test(t)) t += ' ';
  if (!t) return;
  await page.keyboard.type(t, { delay: 1 });
}

/**
 * 本文を入力する。
 * 記法ごとに「本当の空ブロックの先頭」でマーカーを打ち、note側の自動変換で見出し・箇条書き・
 * 引用・コードブロックにする。画像は本文の該当位置に来たらその場で挿入する。
 * inlineImages=false のとき、および位置に置けなかった画像は末尾にまとめる。
 */
export async function fillBody(
  page: Page,
  scope: Page | FrameLocator,
  article: ParsedArticle,
  inlineImages: boolean,
): Promise<FillBodyResult> {
  const body = await firstVisible(bodyCandidates(scope));
  if (!body) throw new Error('本文入力欄が見つかりませんでした（selectors.ts の bodyCandidates を確認）');

  await body.click();

  let imagesInline = 0;
  let linkCards = 0;
  const linkCardsFailed: string[] = [];
  const leftOver: { absPath: string; link?: string }[] = [];
  const imageLinks: ImageLinkRequest[] = [];
  let prev: PrevKind = null;

  for (const line of article.lines) {
    if (line.kind === 'image' && !inlineImages) {
      leftOver.push(line.image);
      continue;
    }

    const continued = await moveToNextBlock(page, prev, line.kind);

    switch (line.kind) {
      case 'heading':
        await page.keyboard.type(line.level === 2 ? '## ' : '### ');
        await typeInline(page, line.text);
        break;
      case 'bullet':
        if (!continued) await page.keyboard.type('- ');
        await typeInline(page, line.text);
        break;
      case 'ordered': {
        if (!continued) await page.keyboard.type('1. ');
        // 番号の行のすぐ下に続けた説明は、Shift+Enter で同じ項目の中に改行して入れる。
        // 段落として入れるとリストが切れ、次の項目が「1.」からやり直しになる（2026-10-03に実機で確認）
        const parts = line.text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await page.keyboard.press('Shift+Enter');
          await typeInline(page, parts[i]);
        }
        break;
      }
      case 'quote':
        if (!continued) await page.keyboard.type('> ');
        await typeInline(page, line.text);
        break;
      case 'code':
        await page.keyboard.type('```');
        await page.waitForTimeout(300); // コードブロックへの変換待ち
        for (let i = 0; i < line.lines.length; i++) {
          if (i > 0) await page.keyboard.press('Enter'); // コードブロックの中は1回が改行
          // 空行のままだと Enter が2回続き、コードブロックから抜けて以降が普通の段落になる。
          // 半角スペースを1つ打って「文字のある行」にしておく（2026-08-26に実機で確認）
          await page.keyboard.type(line.lines[i] || ' ', { delay: 1 });
        }
        break;
      case 'paragraph': {
        // URLだけの行は、Enterを押した瞬間に note がリンクカードへの変換を始める（打っただけでは変わらない）。
        // 変換には1〜3秒かかり、その途中で次のブロックを打つとカードにならず空の段落が残る
        // （2026-08-30・2026-10-03に実機で確認）。Enterのあと変換が終わるまで待ち、カードの下の空行に次を打つ
        const url = line.text.trim();
        if (/^https?:\/\/\S+$/.test(url)) {
          await page.keyboard.type(url, { delay: 1 });
          await page.keyboard.press('Enter');
          if (await waitForLinkCard(page)) {
            linkCards++;
          } else {
            linkCardsFailed.push(url);
            logger.warn({ url }, 'link-card-failed URLだけの行がリンクカードになりませんでした（URLの文字のまま入っています）');
          }
          prev = 'linkcard';
          continue;
        }
        const parts = line.text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await page.keyboard.press('Enter'); // 段落内の改行
          await typeInline(page, parts[i]);
        }
        break;
      }
      case 'image':
        await page.waitForTimeout(400);
        if (await insertImageAtCursor(page, line.image.absPath)) {
          if (line.image.link) imageLinks.push({ index: imagesInline, url: line.image.link, absPath: line.image.absPath });
          imagesInline++;
          await removeEmptyParagraphBeforeImage(page);
          await gotoDocEnd(page, body); // 画像の後はキャプション欄にフォーカスが残るので本文の末尾へ戻す
        } else {
          leftOver.push(line.image);
          logger.warn({ absPath: line.image.absPath }, 'body-image-insert-failed 本文の位置に画像を入れられませんでした');
        }
        break;
    }

    prev = line.kind;
  }

  // 位置に置けなかった画像だけ末尾に回す（保険）
  let appended = 0;
  for (const { absPath, link } of leftOver) {
    await gotoDocEnd(page, body);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    if (await insertImageAtCursor(page, absPath)) {
      if (link) imageLinks.push({ index: imagesInline + appended, url: link, absPath });
      appended++;
    }
  }
  if (appended > 0) {
    logger.warn({ count: appended }, 'images-appended-at-end 位置に置けなかった画像を末尾に追加しました');
  }

  logger.info(
    {
      step: 'body',
      chars: article.bodyText.length,
      imagesInline,
      imagesLeftOver: leftOver.length,
      linkCards,
      linkCardsFailed: linkCardsFailed.length,
      mode: inlineImages ? 'inline' : 'append',
    },
    '本文を入力しました',
  );
  return { imagesInserted: imagesInline + appended, imagesLeftOver: leftOver.length, linkCards, linkCardsFailed, imageLinks };
}

/** 候補のどれかが見えるまで待つ（ボタンや入力欄が、押した直後に少し遅れて出るため） */
async function waitVisible(cands: Locator[], timeout = 5000): Promise<Locator> {
  for (const loc of cands) {
    try {
      const el = loc.first();
      await el.waitFor({ state: 'visible', timeout });
      return el;
    } catch {
      /* 次の候補へ */
    }
  }
  throw new Error('ボタンか入力欄が出ませんでした（selectors.ts の imageLink〜 を確認）');
}

/**
 * 画像の上に出るツールバーのボタンを、止まるのを待ってから、その場所をマウスで押す。
 * locator.click() では「動いている」「見えない」と判定されて押せなかった（2026-10-23に実機で確認。
 * ツールバーは出てから0.3秒ほど動き、そのあとは止まって見えている）
 */
async function clickInPlace(page: Page, el: Locator): Promise<void> {
  let box = await el.boundingBox();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(150);
    const next = await el.boundingBox();
    if (box && next && box.x === next.x && box.y === next.y) break;
    box = next;
  }
  if (!box) throw new Error('ボタンの場所が分かりませんでした');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * リンク付き画像に、noteの画像リンクを付ける（本文と画像をすべて入れ終えてから呼ぶ）。
 * 手順（2026-10-20に実機で確認）: 画像のキャプション欄に入力位置を置く → ↑キーで画像を選ぶ
 * → 画像の上に出るツールバーの「リンク」→ URLの欄（placeholder "https://"）に入れる →「適用」。
 * 画像は押しても選べないので、キーボードで選ぶ。
 * 失敗しても下書きは保存できるよう、例外は握って警告だけ出す。リンクを付けられなかった画像のファイルを返す。
 */
export async function applyImageLinks(page: Page, links: ImageLinkRequest[]): Promise<{ linked: number; failed: string[] }> {
  let linked = 0;
  const failed: string[] = [];
  for (const link of links) {
    try {
      const placed = await page.evaluate(
        (index) => {
          // 本文の画像だけを数える（リンクカードは数えない）
          const editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
          const figs = [...(editor?.querySelectorAll(':scope > figure') ?? [])].filter(
            (f) => f.querySelector('img') && !f.hasAttribute('embedded-service') && !f.hasAttribute('data-src'),
          );
          const fig = figs[index];
          const cap = fig?.querySelector('figcaption');
          if (!editor || !fig || !cap) return false;
          (editor as HTMLElement).focus();
          fig.scrollIntoView({ block: 'center', behavior: 'instant' });
          const range = document.createRange();
          range.setStart(cap, 0);
          range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          return true;
        },
        link.index,
      );
      if (!placed) throw new Error(`本文の${link.index + 1}枚目の画像が見つかりません`);
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(500);
      const selected = await page.evaluate(
        (index) => {
          // 本文の画像だけを数える（リンクカードは数えない）
          const editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
          const figs = [...(editor?.querySelectorAll(':scope > figure') ?? [])].filter(
            (f) => f.querySelector('img') && !f.hasAttribute('embedded-service') && !f.hasAttribute('data-src'),
          );
          return figs[index]?.classList.contains('ProseMirror-selectednode') ?? false;
        },
        link.index,
      );
      if (!selected) throw new Error('画像を選べませんでした');
      await clickInPlace(page, await waitVisible(imageLinkButtonCandidates(page)));
      await (await waitVisible(imageLinkUrlFieldCandidates(page))).fill(link.url);
      await clickInPlace(page, await waitVisible(imageLinkApplyCandidates(page)));
      await page.waitForTimeout(500);
      const href = await page.evaluate(
        (index) => {
          // 本文の画像だけを数える（リンクカードは数えない）
          const editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
          const figs = [...(editor?.querySelectorAll(':scope > figure') ?? [])].filter(
            (f) => f.querySelector('img') && !f.hasAttribute('embedded-service') && !f.hasAttribute('data-src'),
          );
          return figs[index]?.querySelector('a')?.getAttribute('href') ?? null;
        },
        link.index,
      );
      if (href !== link.url) throw new Error('「適用」のあとに画像のリンクが確かめられません');
      linked++;
      logger.info({ step: 'image-link-set', absPath: link.absPath, url: link.url }, '画像にリンクを付けました');
    } catch (e) {
      failed.push(link.absPath);
      logger.warn({ absPath: link.absPath, err: String(e).slice(0, 120) }, 'image-link-failed 画像にリンクを付けられませんでした（画像は入っています）');
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  if (links.length > 0) {
    logger.info({ step: 'image-links-done', requested: links.length, linked }, '画像のリンク付けが終わりました');
  }
  return { linked, failed };
}

/**
 * URLだけの行でEnterを押したあと、リンクカードへの変換が終わるまで待つ。
 * 変換中はその行が空になり、成功すると figure（カード）に、失敗するとURLの文字に戻る（2026-10-03に実機で確認）。
 * カードになれば true。
 */
async function waitForLinkCard(page: Page): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return 'unknown';
      let node: Node | null = sel.getRangeAt(0).startContainer;
      while (node && node.nodeType !== 1) node = node.parentNode;
      let block = node as Element | null;
      while (block?.parentElement && block.parentElement.getAttribute('contenteditable') !== 'true') {
        block = block.parentElement;
      }
      const before = block?.previousElementSibling;
      if (!before) return 'unknown';
      if (before.tagName === 'FIGURE') return 'card';
      return (before.textContent || '').trim() ? 'text' : 'loading';
    });
    if (state === 'card') return true;
    if (state === 'unknown') return false;
    // 文字に戻った＝変換の失敗。Enter直後の一瞬は変換前の文字が見えることがあるので、少し待ってから判定する
    if (state === 'text' && i >= 4) return false;
  }
  return false;
}

/** 本文の末尾にカーソルを移動する（全選択→右で選択解除して末尾へ） */
async function gotoDocEnd(page: Page, body: Locator): Promise<void> {
  await body.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowRight');
}

/**
 * カーソルのある空行に画像を1枚挿入する。
 * 手順（実画面で確認）：「画像を追加」ボタン → メニューの「画像をアップロード」→ ファイル選択(filechooser)。
 */
async function clickAndGetChooser(page: Page, loc: Locator, timeout: number) {
  const [ch] = await Promise.all([page.waitForEvent('filechooser', { timeout }), loc.click()]);
  return ch;
}

/**
 * 画像メニュー（「画像をアップロード」or ＋メニューの「画像」）を開いてファイル選択(filechooser)を得る。
 * 追加ボタンを押してメニューが開いた状態で呼ぶこと。
 */
async function pickUploadChooser(page: Page) {
  const uploadA = page.getByRole('button', { name: /画像をアップロード/ }).first();
  if (await uploadA.isVisible({ timeout: 2000 }).catch(() => false)) {
    return clickAndGetChooser(page, uploadA, 8000).catch(() => null);
  }
  const imgItem = page.getByRole('button', { name: '画像', exact: true }).first();
  if (await imgItem.isVisible({ timeout: 2500 }).catch(() => false)) {
    const ch = await clickAndGetChooser(page, imgItem, 4000).catch(() => null);
    if (ch) return ch;
    const uploadB = page.getByRole('button', { name: /画像をアップロード/ }).first();
    if (await uploadB.isVisible({ timeout: 3000 }).catch(() => false)) {
      return clickAndGetChooser(page, uploadB, 8000).catch(() => null);
    }
  }
  return null;
}

/** アップロード後の切り抜き(crop)モーダルを「保存」で確定する（トップの「下書き保存」と誤爆しないよう完全一致） */
async function confirmCropSave(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="cropper"], .reactEasyCrop_CropArea', { timeout: 10000 }).catch(() => {});
  const cropSave = page.getByRole('button', { name: '保存', exact: true }).first();
  if (await cropSave.isVisible({ timeout: 4000 }).catch(() => false)) {
    await cropSave.click();
  }
  await page.waitForSelector('[data-testid="cropper"]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

/**
 * 本文の追加ボタンを探す。
 * 「画像を追加」はタイトル上部（見出し画像の入口）にも同じ名前で存在するので、
 * 本文エディタより上にあるものは必ず除外する。ここを間違えると本文ではなく見出し画像に入る。
 */
async function findBodyAddButton(page: Page): Promise<Locator | null> {
  const editor = page.locator('div[contenteditable="true"][role="textbox"]').first();
  const editorBox = await editor.boundingBox().catch(() => null);
  const top = editorBox ? editorBox.y - 40 : 220;
  // 追加ボタンは行によって2種類：空行は「画像を追加」、画像の後などは「メニューを開く」(＋)
  for (const group of [
    page.getByRole('button', { name: '画像を追加' }),
    page.getByRole('button', { name: 'メニューを開く' }),
  ]) {
    const n = await group.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const b = group.nth(i);
      if (!(await b.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      const box = await b.boundingBox().catch(() => null);
      if (box && box.y >= top) return b;
    }
  }
  return null;
}

/**
 * 画像の直前に残る空段落を消す。
 * 画像を入れるために作った空ブロックは、画像が別ブロックとして入るため空のまま残る。
 * 空段落にキャレットを置いて Delete（後ろのブロックを引き上げる）で片づける。
 */
async function removeEmptyParagraphBeforeImage(page: Page): Promise<void> {
  const found = await page
    .evaluate(() => {
      const editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
      if (!editor) return false;
      const kids = [...editor.children];
      for (let i = kids.length - 1; i >= 0; i--) {
        const el = kids[i];
        const next = kids[i + 1];
        if (!next || next.tagName !== 'FIGURE') continue;
        if (el.tagName !== 'P' || (el.textContent || '').trim() !== '') continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (!found) return;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
}

/** 本文に入っている画像の枚数。挿入が本当に効いたかの確認に使う */
async function countBodyImages(page: Page): Promise<number> {
  return page
    .evaluate(() => document.querySelectorAll('div[contenteditable="true"][role="textbox"] img').length)
    .catch(() => -1);
}

async function insertImageAtCursor(page: Page, absPath: string): Promise<boolean> {
  const before = await countBodyImages(page);
  try {
    const addImage = await findBodyAddButton(page);
    if (!addImage) {
      logger.warn({ absPath }, '画像の追加ボタン（画像を追加/メニューを開く）が見つからずスキップしました');
      return false;
    }
    await addImage.click();
    await page.waitForTimeout(400);

    const chooser = await pickUploadChooser(page);
    if (!chooser) {
      logger.warn({ absPath }, '画像アップロードの入口が出ずスキップしました');
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }
    await chooser.setFiles(absPath);
    await confirmCropSave(page);
  } catch (e) {
    logger.warn({ absPath, err: String(e).slice(0, 120) }, '本文画像の挿入に失敗、スキップしました');
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  const after = await countBodyImages(page);
  if (before >= 0 && after >= 0 && after <= before) {
    logger.warn({ absPath }, '画像を入れたつもりが本文に増えていませんでした（見出し画像側に入った可能性）');
    return false;
  }
  return true;
}

/**
 * サムネイル（見出し画像）を設定する。タイトル上部の「画像を追加」ボタン（aria-label同じだが上部にある）から、
 * 「画像をアップロード（推奨1280×670）」→ ファイル選択 → 切り抜き保存。
 * 本文入力の前に呼ぶ想定（上部ボタンが一意に取りやすい）。入口が無ければスキップ。
 */
export async function setThumbnail(page: Page, absPath: string): Promise<boolean> {
  // 上部（タイトルより上、y<220）にある「画像を追加」ボタン＝見出し画像の入口
  const buttons = page.getByRole('button', { name: '画像を追加' });
  const count = await buttons.count().catch(() => 0);
  let eyecatch: Locator | null = null;
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i);
    const box = await b.boundingBox().catch(() => null);
    if (box && box.y < 220) { eyecatch = b; break; }
  }
  if (!eyecatch) {
    logger.warn('見出し画像（サムネイル）の入口が見つかりませんでした。スキップします（本文は保存します）');
    return false;
  }
  try {
    await eyecatch.click();
    await page.waitForTimeout(400);
    const chooser = await pickUploadChooser(page);
    if (!chooser) {
      logger.warn('サムネイルのアップロード入口が出ずスキップしました');
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }
    await chooser.setFiles(absPath);
    await confirmCropSave(page);
    logger.info({ step: 'thumbnail' }, 'サムネイルを設定しました');
    return true;
  } catch (e) {
    logger.warn({ err: String(e).slice(0, 120) }, 'サムネイル設定に失敗、スキップしました');
    return false;
  }
}

/** 下書き保存する（このツールの最後の操作）。「公開に進む」には触れない */
export async function saveDraft(page: Page): Promise<string> {
  const btn = await firstVisible(saveDraftCandidates(page), 5000);
  if (!btn) throw new Error('「下書き保存」ボタンが見つかりませんでした（selectors.ts の saveDraftCandidates を確認）');
  const label = (await btn.textContent())?.trim() || '下書き保存';
  await btn.click();
  await page.waitForTimeout(2500);
  logger.info({ step: 'save-draft', label }, '下書き保存を実行しました');
  return label;
}

export { resolveScope };
