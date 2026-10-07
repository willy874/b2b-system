import type { Locator, Page } from '@playwright/test';

/**
 * 列表項目的選擇器：固定的 `data-testid` ＋ 變動的 `data-value`
 * （docs/coding-standards/06-literal-strings.md §3.3）。testid 本身一律以字面量傳入。
 */
export function getByTestIdAndValue(scope: Page | Locator, testId: string, value: string): Locator {
  return scope.locator(`[data-testid="${testId}"][data-value="${value}"]`);
}
