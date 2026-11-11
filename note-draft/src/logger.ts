import pino from 'pino';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOGS_DIR } from './paths.js';

// ログに出してよいのは「ステップ名・結果・文字数・ファイル名・URL」まで。
// 本文全文 / パスワード / Cookie / 認証状態の中身は絶対に出さない。

if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });

// 実行ごとの生ログ（1行1イベント）。日時はファイル名にせず追記型にして単純化。
const logFile = resolve(LOGS_DIR, 'note-auto-draft.log');

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  },
});

/** 監査用に、機微でないイベントだけファイルへ追記する */
export function auditFile(event: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n';
  appendFileSync(logFile, line, 'utf8');
}
