import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import type { AccountKey } from '../fixtures/accounts';
import { getByTestIdAndValue } from './selectors';

export async function login(
  page: Page,
  account: AccountKey,
  password = E2E_PASSWORD,
): Promise<void> {
  await page.goto('/auth/login');
  await page.getByTestId('login-email').fill(ACCOUNTS[account]);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

export async function loginAndWaitForHome(page: Page, account: AccountKey): Promise<void> {
  await login(page, account);
  await expect(page.getByTestId('home-page')).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByTestId('account-menu-trigger').click();
  await getByTestIdAndValue(page, 'menu-item', 'logout').click();
}
