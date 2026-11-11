import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** プロジェクトルート（src の1つ上） */
export const ROOT = resolve(here, '..');

export const STORAGE_DIR = resolve(ROOT, 'storage');
export const LOGS_DIR = resolve(ROOT, 'logs');
export const SCREENSHOTS_DIR = resolve(ROOT, 'screenshots');
export const ARTICLES_DIR = resolve(ROOT, 'articles');

/** テーマ設定と CTA固定画像の置き場（キット直下。note-draft の1つ上） */
export const KIT_ROOT = resolve(ROOT, '..');
export const THEMES_DIR = resolve(KIT_ROOT, 'note-themes');
export const ASSETS_DIR = resolve(KIT_ROOT, 'note-assets');

/** 保存済みログイン状態の保存先（秘密情報扱い・.gitignore済み） */
export const AUTH_STATE_PATH = resolve(STORAGE_DIR, 'note-auth.json');
