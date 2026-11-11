import matter from 'gray-matter';
import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import type {
  ArticleFrontmatter,
  ArticleImageRef,
  ArticleBlock,
  BodyLine,
  ParsedArticle,
} from './types.js';

// 画像 `![alt](画像)` と、リンク付き画像 `[![alt](画像)](URL)`。
// リンク付きは 1:alt 2:画像 3:URL、ふつうの画像は 4:alt 5:画像 に入る
const IMAGE_RE = /\[!\[([^\]]*)\]\(([^)]+)\)\]\((https?:\/\/[^\s)]+)\)|!\[([^\]]*)\]\(([^)]+)\)/g;

/** 記事フォルダ基準で画像パスを絶対パスに解決する */
function resolveImagePath(dir: string, rawPath: string): string {
  const clean = rawPath.trim().replace(/^\.\//, '');
  return isAbsolute(clean) ? clean : resolve(dir, clean);
}

const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|[\s:|-]+\|$/;

/** 表の1行をセルに分ける（`\|` はセル内の縦棒として扱う） */
function splitTableRow(row: string): string[] {
  return row
    .replace(/\\\|/g, '\u0000')
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.replace(/\u0000/g, '|').trim());
}

/**
 * 表のかたまりを箇条書きに変換する。noteに表の機能が無いため。
 * ヘッダ行と区切り行は落とし、1列目を太字の項目名、2列目以降を「 / 」でつないだ説明にする。
 */
function tableBlockToBullets(rows: string[]): string[] {
  const hasHeader = rows.some((r) => TABLE_SEP_RE.test(r));
  const body = rows.filter((r) => !TABLE_SEP_RE.test(r));
  const data = hasHeader ? body.slice(1) : body;
  return data
    .map((r) => splitTableRow(r).filter((c) => c.length > 0))
    .filter((cols) => cols.length > 0)
    .map((cols) => (cols.length === 1 ? cols[0] : `**${cols[0]}**：${cols.slice(1).join(' / ')}`));
}

/** 本文中の表を、箇条書きの行（`- …`）に置き換える */
function tablesToBullets(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_ROW_RE.test(lines[i].trim())) {
      out.push(lines[i]);
      continue;
    }
    const rows: string[] = [];
    while (i < lines.length && TABLE_ROW_RE.test(lines[i].trim())) {
      rows.push(lines[i].trim());
      i++;
    }
    i--;
    for (const b of tableBlockToBullets(rows)) out.push(`- ${b}`);
  }
  return out.join('\n');
}

/**
 * Markdownを「プレーンテキスト寄り」に整える（文字数の計算と確認表示に使う）。
 * 見出しの # や太字の ** など、note上でそのまま出ると不自然な記号だけ落とす。
 * 画像記法はここでは触らず、呼び出し側でブロック分割してから処理する。
 */
function mdInlineToText(md: string): string {
  return tablesToBullets(md)
    // 見出し「## 1. タイトル」の番号は、noteで番号リストに自動変換されるので番号ごと落とす
    .replace(/^#{1,6}\s+\d+[.．]\s*/gm, '')
    .replace(/^#{1,6}\s+/gm, '') // 見出しマーカー
    .replace(/^\s*>\s?/gm, '') // 引用マーカー
    .replace(/^\s*[-*+]\s+/gm, '・') // 箇条書き→中黒
    .replace(/^\s*\d+\.\s+/gm, (m) => m.replace(/\s+$/, ' ')) // 番号リストは番号を残す
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 太字
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1') // 斜体
    .replace(/`([^`]+)`/g, '$1') // インラインコード
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') // リンクはテキストだけ
    .replace(/^\s*---\s*$/gm, '') // 水平線
    .replace(/\n{3,}/g, '\n\n') // 連続改行を詰める
    .trim();
}

/**
 * 本文を「種類つきのブロック列」に分解する。
 * note側のMarkdown自動変換を起こすため、見出し・箇条書き・引用・コードブロックは
 * 記号を落とさず種類として保つ（インライン記法は text に含めたまま渡す）。
 * 画像は出現順に images と突き合わせる。
 */
function parseBodyLines(content: string, images: ArticleImageRef[]): BodyLine[] {
  const out: BodyLine[] = [];
  const rawLines = content.split('\n');
  let para: string[] = [];
  let imageIdx = 0;
  let orderedOpen = false;

  const flushPara = () => {
    if (para.length) {
      out.push({ kind: 'paragraph', text: para.join('\n') });
      para = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    const continuesOrdered = orderedOpen;
    orderedOpen = false;

    if (/^```/.test(t)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < rawLines.length && !/^```/.test(rawLines[i].trim())) {
        code.push(rawLines[i]);
        i++;
      }
      out.push({ kind: 'code', lines: code });
      continue;
    }

    if (!t) {
      flushPara();
      continue;
    }

    IMAGE_RE.lastIndex = 0;
    if (IMAGE_RE.test(t)) {
      IMAGE_RE.lastIndex = 0;
      flushPara();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = IMAGE_RE.exec(t)) !== null) {
        const before = t.slice(last, m.index).trim();
        if (before) out.push({ kind: 'paragraph', text: before });
        const image = images[imageIdx++];
        if (image) out.push({ kind: 'image', image });
        last = m.index + m[0].length;
      }
      const after = t.slice(last).trim();
      if (after) out.push({ kind: 'paragraph', text: after });
      continue;
    }

    // 表はnoteに機能が無いので、箇条書き「**項目**：説明」に変換して入れる
    if (TABLE_ROW_RE.test(t)) {
      flushPara();
      const rows: string[] = [];
      while (i < rawLines.length && TABLE_ROW_RE.test(rawLines[i].trim())) {
        rows.push(rawLines[i].trim());
        i++;
      }
      i--; // for文の i++ と相殺する
      for (const text of tableBlockToBullets(rows)) out.push({ kind: 'bullet', text });
      continue;
    }

    const heading = t.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      // 「## 1. タイトル」の番号は、見出し内で番号リストに変換されてしまうので落とす
      out.push({
        kind: 'heading',
        level: heading[1].length <= 2 ? 2 : 3,
        text: heading[2].replace(/^\d+[.．]\s*/, ''),
      });
      continue;
    }

    const quote = t.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      out.push({ kind: 'quote', text: quote[1] });
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(t.replace(/\s+/g, ''))) {
      flushPara(); // 水平線はnoteに無いので落とす
      continue;
    }

    const bullet = t.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushPara();
      out.push({ kind: 'bullet', text: bullet[1] });
      continue;
    }

    const ordered = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      flushPara();
      out.push({ kind: 'ordered', num: Number(ordered[1]), text: ordered[2] });
      orderedOpen = true;
      continue;
    }

    // 番号の行のすぐ下（空行なし）に続けた行は、その項目の続きとして持つ
    const last = out[out.length - 1];
    if (continuesOrdered && last?.kind === 'ordered') {
      last.text += '\n' + t;
      orderedOpen = true;
      continue;
    }

    para.push(t);
  }
  flushPara();
  return out;
}

export function parseArticle(articleDir: string): ParsedArticle {
  const dir = resolve(articleDir);
  const mdPath = resolve(dir, 'article.md');
  const raw = readFileSync(mdPath, 'utf8');
  const { data, content } = matter(raw);

  const fm: ArticleFrontmatter = {
    title: typeof data.title === 'string' ? data.title.trim() : '',
    thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail.trim() : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map((t: unknown) => String(t)) : undefined,
  };

  // 本文をブロック（テキスト / 画像）に分割
  const blocks: ArticleBlock[] = [];
  const images: ArticleImageRef[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  IMAGE_RE.lastIndex = 0;

  const pushText = (segment: string) => {
    const text = mdInlineToText(segment);
    if (text.length > 0) blocks.push({ type: 'text', text });
  };

  while ((match = IMAGE_RE.exec(content)) !== null) {
    const alt = match[1] ?? match[4] ?? '';
    const rawPath = match[2] ?? match[5];
    const link = match[3];
    pushText(content.slice(lastIndex, match.index));
    const image: ArticleImageRef = {
      alt,
      rawPath: rawPath.trim(),
      absPath: resolveImagePath(dir, rawPath),
      position: images.length,
      ...(link ? { link } : {}),
    };
    images.push(image);
    blocks.push({ type: 'image', image });
    lastIndex = match.index + match[0].length;
  }
  pushText(content.slice(lastIndex));

  const bodyText = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n');

  const thumbnailAbsPath = fm.thumbnail ? resolveImagePath(dir, fm.thumbnail) : undefined;
  const lines = parseBodyLines(content, images);

  return { dir, frontmatter: fm, bodyText, images, blocks, lines, thumbnailAbsPath };
}
