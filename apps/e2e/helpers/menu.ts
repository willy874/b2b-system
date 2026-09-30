import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** 側邊選單的分類（父選單）預設只展開當前頁面所在的那個；要點其他分類的子項前先展開。 */
export async function openMenuGroup(page: Page, groupTestId: string): Promise<void> {
  const toggle = page.getByTestId(groupTestId);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
