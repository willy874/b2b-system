import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** 關鍵快照的輸出資料夾（不進版控；global-setup 每次執行前清空）。 */
export const SNAPSHOT_DIR = fileURLToPath(new URL('../snapshots/', import.meta.url));

/** 檔名不能用的字元；中文保留，方便對照測試標題。 */
const UNSAFE_PATH_CHARS = /[\\/:*?"<>|\s]+/g;
const MAX_TITLE_LENGTH = 80;

/** 每個 test（含重試）各自編號，檔名照拍攝順序排列。 */
const counters = new Map<string, number>();

function toPathSegment(text: string): string {
  return text.replace(UNSAFE_PATH_CHARS, '_').slice(0, MAX_TITLE_LENGTH);
}

/**
 * 在流程的關鍵狀態拍一張整頁截圖（docs/architecture/frontend/10-testing.md §4.5），存到
 * `snapshots/<spec>/<test 標題>/<序號>-<name>.png`，同時附在 HTML report 上。
 * 只是留紀錄給人看，不做比對；驗證仍然靠 `expect`，要在畫面穩定（expect 通過）之後才拍。
 *
 * @param name 這個狀態的名稱：kebab-case 字面量，不以字串模板組成
 */
export async function snapshot(page: Page, name: string): Promise<void> {
  const info = test.info();
  const key = `${info.testId}#${info.retry}`;
  const order = (counters.get(key) ?? 0) + 1;
  counters.set(key, order);

  const spec = basename(info.file, '.spec.ts');
  const title = toPathSegment(info.retry > 0 ? `${info.title}_retry${info.retry}` : info.title);
  const path = `${SNAPSHOT_DIR}${spec}/${title}/${String(order).padStart(2, '0')}-${name}.png`;

  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}
