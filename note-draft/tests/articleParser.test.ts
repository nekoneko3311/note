import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArticle } from '../src/articleParser.js';

const TMP = resolve(process.cwd(), 'tests/.tmp-parser');

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(resolve(TMP, 'images'), { recursive: true });
  writeFileSync(resolve(TMP, 'images/a.png'), 'x');
  writeFileSync(resolve(TMP, 'images/b.jpg'), 'x');
  writeFileSync(
    resolve(TMP, 'article.md'),
    [
      '---',
      'title: テスト記事',
      'thumbnail: ./thumb.png',
      'tags:',
      '  - AI',
      '  - 副業',
      '---',
      '',
      '# 見出し1',
      '',
      'これは**本文**です。',
      '',
      '![alt1](./images/a.png)',
      '',
      '## 見出し2',
      '',
      '- 項目1',
      '- 項目2',
      '',
      '![alt2](./images/b.jpg)',
      '',
      '終わりの段落。',
    ].join('\n'),
  );
});

describe('parseArticle', () => {
  it('frontmatter を読み取る', () => {
    const a = parseArticle(TMP);
    expect(a.frontmatter.title).toBe('テスト記事');
    expect(a.frontmatter.tags).toEqual(['AI', '副業']);
    expect(a.thumbnailAbsPath).toContain('thumb.png');
  });

  it('本文画像を出現順に抽出する', () => {
    const a = parseArticle(TMP);
    expect(a.images).toHaveLength(2);
    expect(a.images[0].alt).toBe('alt1');
    expect(a.images[0].absPath.replace(/\\/g, '/')).toContain('images/a.png');
    expect(a.images[1].rawPath).toBe('./images/b.jpg');
  });

  it('見出し#や太字**を落としてプレーンテキスト化する', () => {
    const a = parseArticle(TMP);
    expect(a.bodyText).toContain('見出し1');
    expect(a.bodyText).not.toContain('#');
    expect(a.bodyText).not.toContain('**');
    expect(a.bodyText).toContain('・項目1');
  });

  it('ブロックはテキストと画像が交互に並ぶ', () => {
    const a = parseArticle(TMP);
    const types = a.blocks.map((b) => b.type);
    expect(types).toContain('image');
    expect(types.filter((t) => t === 'image')).toHaveLength(2);
  });

  it('lines は記法を種類として保つ', () => {
    const a = parseArticle(TMP);
    const kinds = a.lines.map((l) => l.kind);
    expect(kinds).toEqual(['heading', 'paragraph', 'image', 'heading', 'bullet', 'bullet', 'image', 'paragraph']);
    const first = a.lines[0];
    expect(first.kind === 'heading' && first.level).toBe(2);
    const para = a.lines[1];
    expect(para.kind === 'paragraph' && para.text).toBe('これは**本文**です。');
    const bullet = a.lines[4];
    expect(bullet.kind === 'bullet' && bullet.text).toBe('項目1');
  });
});

const TMP2 = resolve(process.cwd(), 'tests/.tmp-parser2');

describe('parseArticle: 引用・コードブロック・番号リスト', () => {
  beforeAll(() => {
    rmSync(TMP2, { recursive: true, force: true });
    mkdirSync(TMP2, { recursive: true });
    writeFileSync(
      resolve(TMP2, 'article.md'),
      [
        '---',
        'title: 記法テスト',
        '---',
        '',
        '### 小見出し',
        '',
        '> 引用です',
        '',
        '1. 一番目',
        '2. 二番目',
        '',
        '```bash',
        'npm run draft',
        'echo done',
        '```',
        '',
        '---',
        '',
        '最後。',
      ].join('\n'),
    );
  });

  it('種類ごとに分解し、水平線は落とす', () => {
    const a = parseArticle(TMP2);
    const kinds = a.lines.map((l) => l.kind);
    expect(kinds).toEqual(['heading', 'quote', 'ordered', 'ordered', 'code', 'paragraph']);
  });

  it('小見出しは level 3 になる', () => {
    const a = parseArticle(TMP2);
    const h = a.lines[0];
    expect(h.kind === 'heading' && h.level).toBe(3);
  });

  it('コードブロックの中身を保つ', () => {
    const a = parseArticle(TMP2);
    const code = a.lines[4];
    expect(code.kind === 'code' && code.lines).toEqual(['npm run draft', 'echo done']);
  });

  it('番号リストは元の番号を保つ', () => {
    const a = parseArticle(TMP2);
    const nums = a.lines.flatMap((l) => (l.kind === 'ordered' ? [l.num] : []));
    expect(nums).toEqual([1, 2]);
  });
});

const TMP2B = resolve(process.cwd(), 'tests/.tmp-parser2b');

describe('parseArticle: 番号の行のすぐ下の説明', () => {
  beforeAll(() => {
    rmSync(TMP2B, { recursive: true, force: true });
    mkdirSync(TMP2B, { recursive: true });
    writeFileSync(
      resolve(TMP2B, 'article.md'),
      ['---', 'title: X', '---', '', '1. **一つ目**', '一つ目の説明', '2. **二つ目**', '二つ目の説明', '', 'リストのあと'].join('\n'),
    );
  });

  it('空行なしで続けた行は、その項目の続きになる', () => {
    const a = parseArticle(TMP2B);
    expect(a.lines.map((l) => l.kind)).toEqual(['ordered', 'ordered', 'paragraph']);
    const first = a.lines[0];
    expect(first.kind === 'ordered' && first.text).toBe('**一つ目**\n一つ目の説明');
  });
});

const TMP3 = resolve(process.cwd(), 'tests/.tmp-parser3');

describe('parseArticle: 表', () => {
  beforeAll(() => {
    rmSync(TMP3, { recursive: true, force: true });
    mkdirSync(TMP3, { recursive: true });
    writeFileSync(
      resolve(TMP3, 'article.md'),
      [
        '---',
        'title: 表テスト',
        '---',
        '',
        '前の段落。',
        '',
        '| 項目 | 説明 |',
        '|---|---|',
        '| Aプラン | 月1,000円 |',
        '| Bプラン | 月2,000円 |',
        '',
        '3列の表。',
        '',
        '| 道具 | 料金 | 用途 |',
        '| --- | --- | --- |',
        '| Codex | 無料 | 画像 |',
        '',
        '後ろの段落。',
      ].join('\n'),
    );
  });

  it('表を箇条書きに変換し、ヘッダ行と区切り行は落とす', () => {
    const a = parseArticle(TMP3);
    const kinds = a.lines.map((l) => l.kind);
    expect(kinds).toEqual(['paragraph', 'bullet', 'bullet', 'paragraph', 'bullet', 'paragraph']);
    const first = a.lines[1];
    expect(first.kind === 'bullet' && first.text).toBe('**Aプラン**：月1,000円');
  });

  it('3列以上は2列目以降を「 / 」でつなぐ', () => {
    const a = parseArticle(TMP3);
    const row = a.lines[4];
    expect(row.kind === 'bullet' && row.text).toBe('**Codex**：無料 / 画像');
  });

  it('文字数計算でも表は箇条書きになり、縦棒が残らない', () => {
    const a = parseArticle(TMP3);
    expect(a.bodyText).not.toContain('|');
    expect(a.bodyText).toContain('・Aプラン：月1,000円');
  });
});

const TMP4 = resolve(process.cwd(), 'tests/.tmp-parser4');

describe('parseArticle: リンク付き画像', () => {
  beforeAll(() => {
    rmSync(TMP4, { recursive: true, force: true });
    mkdirSync(resolve(TMP4, 'images'), { recursive: true });
    writeFileSync(resolve(TMP4, 'images/cta-line.png'), 'x');
    writeFileSync(resolve(TMP4, 'images/a.png'), 'x');
    writeFileSync(
      resolve(TMP4, 'article.md'),
      [
        '---',
        'title: X',
        '---',
        '',
        '文章',
        '',
        '![ふつうの画像](./images/a.png)',
        '',
        '[![公式LINEの友だち追加](./images/cta-line.png)](https://example.com/line)',
        '',
        '友だち追加はこちらから https://example.com/line',
      ].join('\n'),
    );
  });

  it('リンク付き画像を、リンク先つきの画像1枚として読む', () => {
    const a = parseArticle(TMP4);
    expect(a.images).toHaveLength(2);
    expect(a.images[0].link).toBeUndefined();
    expect(a.images[1].rawPath).toBe('./images/cta-line.png');
    expect(a.images[1].alt).toBe('公式LINEの友だち追加');
    expect(a.images[1].link).toBe('https://example.com/line');
  });

  it('「[」や「](URL)」の切れ端を本文に残さない', () => {
    const a = parseArticle(TMP4);
    expect(a.lines.map((l) => l.kind)).toEqual(['paragraph', 'image', 'image', 'paragraph']);
    const linked = a.lines[2];
    expect(linked.kind === 'image' && linked.image.link).toBe('https://example.com/line');
    expect(a.bodyText).not.toContain('[');
    expect(a.bodyText).not.toContain('](');
  });
});
