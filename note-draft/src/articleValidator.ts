import { existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { ParsedArticle, ValidationIssue, ValidationResult } from './types.js';
import { SUPPORTED_IMAGE_EXT } from './types.js';

function isSupportedImage(p: string): boolean {
  return (SUPPORTED_IMAGE_EXT as readonly string[]).includes(extname(p).toLowerCase());
}

/**
 * note にアクセスする前のローカル検証。
 * ここで弾ければ、ブラウザを開かずに止められる。
 */
export function validateArticle(article: ParsedArticle): ValidationResult {
  const issues: ValidationIssue[] = [];

  // article.md（呼び出し前に parse 済みなので存在は保証されるが、念のため）
  if (!existsSync(article.dir)) {
    issues.push({ level: 'error', message: `記事フォルダが見つかりません: ${article.dir}` });
  }

  // タイトル
  if (!article.frontmatter.title) {
    issues.push({ level: 'error', message: 'title が空です（frontmatter に title を書いてください）' });
  } else if (article.frontmatter.title.length > 100) {
    issues.push({ level: 'warn', message: `title が長すぎる可能性があります（${article.frontmatter.title.length}文字）` });
  }

  // 本文
  if (article.bodyText.trim().length === 0) {
    issues.push({ level: 'error', message: '本文が空です' });
  }

  // 本文画像
  for (const img of article.images) {
    if (!existsSync(img.absPath)) {
      issues.push({ level: 'error', message: `本文画像が存在しません: ${img.rawPath}` });
      continue;
    }
    if (!isSupportedImage(img.absPath)) {
      issues.push({
        level: 'error',
        message: `本文画像が非対応の拡張子です（対応: ${SUPPORTED_IMAGE_EXT.join(', ')}）: ${img.rawPath}`,
      });
    }
  }

  // サムネイル（任意）。指定があるのに無い/非対応ならエラー。
  if (article.frontmatter.thumbnail) {
    const t = article.thumbnailAbsPath!;
    if (!existsSync(t)) {
      issues.push({ level: 'error', message: `サムネイルが存在しません: ${article.frontmatter.thumbnail}` });
    } else if (!isSupportedImage(t)) {
      issues.push({ level: 'error', message: `サムネイルが非対応の拡張子です: ${article.frontmatter.thumbnail}` });
    } else if (statSync(t).size > 10 * 1024 * 1024) {
      issues.push({ level: 'warn', message: 'サムネイルが10MBを超えています。アップロードに失敗する可能性があります' });
    }
  } else {
    issues.push({ level: 'warn', message: 'サムネイル（thumbnail）が未指定です。noteの見出し画像は空になります' });
  }

  // リスト行の全角スペース：note のエディタがリスト変換に失敗し、
  // 以降の見出し・段落がすべてリストに巻き込まれる（2026-08-25に実機で確認）
  const bulletFullWidth = article.lines
    .filter((l) => (l.kind === 'bullet' || l.kind === 'ordered') && l.text.split('\n')[0].includes('\u3000'))
    .map((l) => (l as { text: string }).text);
  if (bulletFullWidth.length > 0) {
    issues.push({
      level: 'error',
      message:
        `リスト行に全角スペースがあります（${bulletFullWidth.length}件）。表から変換した行も含みます。` +
        'note のリスト変換が壊れて、以降が全部箇条書きになります。' +
        `「｜」などに置き換えてください。例: ${bulletFullWidth[0].slice(0, 24)}`,
    });
  }

  // note は番号リストの始まりの番号を保存しない。段落をはさんで「2.」から再開しても、保存すると1に戻る（2026-10-03に実機で確認）
  const restarted = article.lines.filter(
    (l, i) => l.kind === 'ordered' && l.num > 1 && article.lines[i - 1]?.kind !== 'ordered',
  ) as { num: number; text: string }[];
  if (restarted.length > 0) {
    issues.push({
      level: 'warn',
      message:
        `番号リストが途中の番号から始まっています（${restarted.length}件）。note では1からやり直しになります。` +
        '説明は番号の行のすぐ下に空行を入れずに書くと、同じ項目の中に入って番号が続きます。' +
        `例: ${restarted[0].num}. ${restarted[0].text.split('\n')[0].slice(0, 20)}`,
    });
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, issues, article };
}
