import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

/** 導覽截圖的輸出資料夾：進版控，docs/guide/introduction/03-feature-tour.md 直接引用。 */
export const TOUR_IMAGE_DIR = fileURLToPath(
  new URL('../../../docs/guide/images/tour/', import.meta.url),
);

/**
 * 等畫面靜止後拍一張整個視窗的 JPEG。
 *
 * @param name 檔名（kebab-case 字面量），文件以 `images/tour/<name>.jpg` 引用
 */
export async function shoot(page: Page, name: string): Promise<void> {
  // 不能等 networkidle：realtime 的連線與 Vite 的 HMR 一直開著
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="skeleton"],[data-testid="page-skeleton"]').length ===
      0,
  );
  await page.evaluate(() => document.fonts.ready);
  // 讓 toast、過場動畫與延遲載入的縮圖結束
  await page.waitForTimeout(700);
  await page.screenshot({
    path: `${TOUR_IMAGE_DIR}${name}.jpg`,
    type: 'jpeg',
    quality: 82,
    animations: 'disabled',
    caret: 'hide',
  });
}
