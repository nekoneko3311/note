import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseArticle } from './articleParser.js';
import { validateArticle } from './articleValidator.js';
import { runLogin, hasSavedAuth } from './noteSession.js';
import { createDraft } from './noteDraftWriter.js';
import { resolveRuntimeOptions } from './config.js';
import { STORAGE_DIR, LOGS_DIR, SCREENSHOTS_DIR, ROOT, THEMES_DIR, ASSETS_DIR } from './paths.js';
import { logger } from './logger.js';
import { resolve } from 'node:path';

/** 一覧が長くなりすぎないよう、上限まで並べて残りは件数で示す */
function listUpTo(items: string[], max: number): string {
  if (items.length <= max) return items.join(' / ');
  return `${items.slice(0, max).join(' / ')} ほか${items.length - max}件`;
}

/** テーマ設定を「## 見出し → 中身」に分解する（見出しの丸かっこ書きは無視して突き合わせる） */
function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let key = '';
  let buf: string[] = [];
  const push = () => {
    if (key) out.set(key, buf.join('\n').replace(/\s+/g, ' ').trim());
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      push();
      key = m[1].split('（')[0].trim();
      buf = [];
    } else if (key) {
      buf.push(line);
    }
  }
  push();
  return out;
}

/** テーマ設定（~/note-kit/note-themes）を点検する。ここが空だと記事の質が落ちる */
function checkThemes(): void {
  console.log('\n== テーマ設定 ==');
  if (!existsSync(THEMES_DIR)) {
    console.log(`✗ テーマ設定のフォルダが見つかりません: ${THEMES_DIR}`);
    console.log('  キットは ~/note-kit（ユーザーフォルダの直下）に置いてください。');
    return;
  }
  const files = readdirSync(THEMES_DIR).filter(
    (f) => f.endsWith('.md') && f !== 'README.md' && f !== '_template.md',
  );
  // 同梱の記入例（ai-fukugyo / mile / ryori）は「本人のテーマ」に数えない
  const mine = files.filter((f) => !readFileSync(resolve(THEMES_DIR, f), 'utf8').includes('記入例'));

  if (mine.length === 0) {
    console.log('✗ あなたのテーマがまだありません');
    console.log('  note-themes/_template.md をコピーして1枚作ってください（Claudeに「セットアップして」と言えば作ってくれます）。');
    return;
  }
  console.log(`✓ あなたのテーマ ${mine.join(', ')}`);

  const tplPath = resolve(THEMES_DIR, '_template.md');
  const tpl = existsSync(tplPath) ? splitSections(readFileSync(tplPath, 'utf8')) : new Map<string, string>();
  // この2つが埋まっていないと、記事がその人の文章にならない
  const CRITICAL = ['読者', '文章のサンプル'];

  // ひな形にある項目の一覧。**消してよい**ものもあるので、欠けていること自体は異常ではない
  const known = [...tpl.keys()].filter((h) => h !== 'CTA固定画像');

  for (const f of mine) {
    const text = readFileSync(resolve(THEMES_DIR, f), 'utf8');
    const sections = splitSections(text);

    // そもそもテーマ設定の形をしているか。ひな形の項目が2つ以下なら、別物とみなす
    const missing = known.filter((h) => !sections.has(h));
    const present = known.length - missing.length;
    if (known.length > 0 && present <= 2) {
      console.log(`✗ ${f} はテーマ設定の形になっていません（ひな形の項目が${present}個しか見つかりません）`);
      console.log('  Claudeに「テーマ設定を作り直して」と伝えてください（この内容は引き継げません）。');
      continue;
    }
    // 項目が欠けていても異常ではない。消したのかもしれないし、新しい版で増えた項目かもしれない
    if (missing.length > 0) {
      console.log(`△ ${f} に次の項目がありません: ${listUpTo(missing, 5)}`);
      console.log('  要らなくて消したのなら、そのままで問題ありません。足したいときは、Claudeに「テーマ設定に◯◯の項目を足して」と伝えてください。');
    }

    // ひな形の説明文がそのまま残っている節を見つける
    const untouched: string[] = [];
    for (const [head, body] of sections) {
      const tplBody = tpl.get(head);
      if (tplBody && body.length > 0 && body === tplBody) untouched.push(head);
    }
    if (untouched.length) {
      const critical = untouched.filter((h) => CRITICAL.includes(h));
      const mark = critical.length ? '✗' : '△';
      if (untouched.length >= 8) {
        console.log(`${mark} ${f} は、ほとんどの項目がひな形の説明文のままです（${untouched.length}項目）`);
      } else {
        console.log(`${mark} ${f} の次の項目が、ひな形の説明文のままです: ${listUpTo(untouched, 5)}`);
      }
      if (critical.length) {
        console.log(`  とくに「${critical.join('」「')}」は、埋めないと記事があなたの文章になりません。`);
      } else {
        console.log('  そのままでも動きますが、埋めるほど記事が自分に近づきます。');
      }
    }

    const blanks: string[] = [];
    let section = '';
    for (const line of text.split('\n')) {
      const h = line.match(/^##\s+(.+)$/);
      if (h) section = h[1].trim();
      const unfilled = line.includes('（要記入）') || line.includes('（例：') || line.includes('（例 ');
      const short = section.split('（')[0].trim();
      if (unfilled && section && !blanks.includes(short) && !untouched.includes(short)) blanks.push(short);
    }
    if (blanks.length) {
      console.log(`△ ${f} に未記入の項目があります: ${listUpTo(blanks, 5)}`);
      console.log('  空でも動きますが、記事があなたらしくなりません。');
    } else if (untouched.length === 0) {
      console.log(`✓ ${f} は全部埋まっています`);
    }

    if (text.includes('CTA固定画像')) {
      const name = f.replace(/\.md$/, '');
      const dir = resolve(ASSETS_DIR, name);
      const imgs = existsSync(dir)
        ? readdirSync(dir).filter((x) => /\.(png|jpe?g|webp)$/i.test(x))
        : [];
      if (imgs.length) {
        console.log(`✓ 毎回入れるバナー note-assets/${name}/（${imgs.length}枚）`);
      } else {
        console.log(`△ ${f} に「CTA固定画像」の節がありますが、note-assets/${name}/ に画像がありません`);
        console.log('  毎回入れるバナーが無いなら、テーマ設定からその節ごと消してください（記事を書くたびに探しに行って止まります）。');
      }
    }
  }
}

const program = new Command();
program.name('note-auto-draft').description('note.com へ記事を自動で「下書き入稿」するローカルツール（公開はしない）');

// ---- doctor ----
program
  .command('doctor')
  .description('実行環境と設定を点検する')
  .action(() => {
    const ok = (b: boolean) => (b ? '✓' : '✗');
    let node = '', npm = '', pw = '', codex = '';
    try { node = process.version; } catch { /* noop */ }
    try { npm = execSync('npm -v').toString().trim(); } catch { /* noop */ }
    try { pw = execSync('npx playwright --version', { cwd: ROOT }).toString().trim(); } catch { /* noop */ }
    try { codex = execSync('codex --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* noop */ }

    const pwCache = process.platform === 'win32'
      ? resolve(process.env.LOCALAPPDATA ?? resolve(process.env.USERPROFILE ?? '', 'AppData/Local'), 'ms-playwright')
      : process.platform === 'darwin'
        ? resolve(process.env.HOME ?? '', 'Library/Caches/ms-playwright')
        : resolve(process.env.HOME ?? '', '.cache/ms-playwright');
    const chromium = existsSync(pwCache);
    const gi = existsSync(resolve(ROOT, '.gitignore')) ? readFileSync(resolve(ROOT, '.gitignore'), 'utf8') : '';
    const gitignoreOk = gi.includes('note-auth.json') && gi.includes('.env');

    console.log('== doctor ==');
    console.log(`${ok(!!node)} Node.js ${node}`);
    console.log(`${ok(!!npm)} npm ${npm}`);
    console.log(`${ok(!!pw)} Playwright ${pw}`);
    console.log(`${ok(chromium)} Chromium (ms-playwright cache)`);
    console.log(`${ok(existsSync(STORAGE_DIR))} storage/`);
    console.log(`${ok(existsSync(LOGS_DIR))} logs/`);
    console.log(`${ok(existsSync(SCREENSHOTS_DIR))} screenshots/`);
    console.log(`${ok(gitignoreOk)} .gitignore に秘密ファイル（note-auth.json / .env）が入っている`);
    console.log(`${ok(hasSavedAuth())} 保存済みログイン状態 storage/note-auth.json（無ければ npm run login）`);
    console.log(codex
      ? `✓ 画像づくりの道具 Codex ${codex}（見出し画像・図解・イラストが作れます）`
      : '- 画像づくりの道具 Codex（未導入）… 図解は作れます。見出し画像とイラストも作るなら npm install -g @openai/codex');

    checkThemes();
  });

// ---- login ----
program
  .command('login')
  .description('ブラウザで手動ログインし、ログイン状態だけを保存する')
  .action(async () => {
    await runLogin();
  });

// ---- dry-run ----
program
  .command('dry-run')
  .argument('<dir>', '記事フォルダ（例: articles/sample）')
  .description('note にアクセスせず、記事フォルダの中身だけ検証する')
  .action((dir: string) => {
    const article = parseArticle(dir);
    const result = validateArticle(article);
    console.log('\n== dry-run ==');
    console.log(`記事フォルダ: ${dir}`);
    console.log(`タイトル: ${article.frontmatter.title || '(なし)'}`);
    console.log(`本文文字数: ${article.bodyText.length.toLocaleString()}`);
    console.log(`本文画像: ${article.images.length}枚`);
    console.log(`サムネイル: ${article.frontmatter.thumbnail ?? '(なし)'}`);
    console.log(`タグ: ${article.frontmatter.tags?.join(', ') ?? '(なし)'}`);
    if (result.issues.length) {
      console.log('\n-- チェック --');
      for (const i of result.issues) console.log(`${i.level === 'error' ? '✗ ERROR' : '△ WARN '} ${i.message}`);
    }
    console.log(`\n結果: ${result.ok ? 'OK（note にはまだアクセスしていません）' : 'NG（上の ERROR を直してください）'}`);
    if (!result.ok) process.exitCode = 1;
  });

// ---- draft ----
program
  .command('draft')
  .argument('<dir>', '記事フォルダ（例: articles/sample）')
  .option('--headed', 'ブラウザを見える状態で実行（既定）', true)
  .option('--headless', 'ブラウザを見せずに実行')
  .option('--pause-on-error', '失敗したときにブラウザを閉じない（画面を見て原因を調べる用）')
  .option('--no-inline-images', '画像を本文中に挿入せず末尾にまとめる（安定重視）')
  .description('記事を note の下書きまで入稿する（公開はしない）')
  .action(async (dir: string, options: { headed?: boolean; headless?: boolean; pauseOnError?: boolean; inlineImages?: boolean }) => {
    if (!hasSavedAuth()) {
      logger.error('保存済みログイン状態がありません。先に `npm run login` を実行してください。');
      process.exitCode = 1;
      return;
    }
    const article = parseArticle(dir);
    const validation = validateArticle(article);
    for (const i of validation.issues) {
      if (i.level === 'error') logger.error(i.message);
      else logger.warn(i.message);
    }
    if (!validation.ok) {
      logger.error('検証エラーのため中止します（note にはアクセスしていません）。');
      process.exitCode = 1;
      return;
    }

    const opts = resolveRuntimeOptions({
      headed: options.headless ? false : true,
      pauseOnError: !!options.pauseOnError,
      inlineImages: options.inlineImages !== false,
    });

    logger.info({ dir, headed: opts.headed, inlineImages: opts.inlineImages }, '下書き作成を開始します');
    const result = await createDraft(article, opts);

    console.log('\n== draft result ==');
    if (result.ok) {
      console.log('✓ 下書き保存まで完了しました（公開はしていません）');
      console.log(`  下書きURL: ${result.draftUrl}`);
      console.log(`  本文画像: ${result.imagesInserted}枚 挿入（本文の位置に置けず末尾に回した画像: ${result.imagesLeftOver ?? 0}枚）`);
      console.log(`  リンクカード: ${result.linkCards ?? 0}個`);
      if (result.linkCardsFailed?.length) {
        console.log(`  リンクカードにならなかったURL（文字のリンクのまま入っています）: ${result.linkCardsFailed.join(' ')}`);
      }
      if (result.imageLinksSet || result.imageLinksFailed?.length) {
        console.log(`  リンク付き画像: ${result.imageLinksSet ?? 0}枚にリンクを付けました`);
      }
      if (result.imageLinksFailed?.length) {
        console.log(`  リンクを付けられなかった画像（画像は入っています。下書き画面で手で付けてください）: ${result.imageLinksFailed.join(' ')}`);
      }
      console.log(`  サムネイル: ${result.thumbnailSet ? '設定済み' : '未設定'}`);
      console.log(`  スクリーンショット: ${result.screenshot}`);
      console.log('\n  → note の画面で内容を確認し、問題なければ手動で公開してください。');
    } else {
      console.log('✗ 失敗しました。');
      console.log(`  理由: ${result.error}`);
      console.log('  logs/ と screenshots/ を確認してください。--pause-on-error で画面を見ながら調べられます。');
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
