import { request } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import type { AccountKey } from '../fixtures/accounts';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';

/** 直接打後端做前置準備（比走 UI 快且穩定）。 */
export async function apiLogin(account: AccountKey): Promise<string> {
  const context = await request.newContext({ baseURL: API_BASE });
  const response = await context.post('/auth/login', {
    data: { email: ACCOUNTS[account], password: E2E_PASSWORD },
  });
  const body = (await response.json()) as { data: { accessToken: string } };
  await context.dispose();
  return body.data.accessToken;
}

export async function apiRequest(
  token: string,
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  data?: unknown,
): Promise<{ status: number; body: unknown }> {
  const context = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const response = await context[method](path, data ? { data } : undefined);
  const text = await response.text();
  await context.dispose();
  return { status: response.status(), body: text ? (JSON.parse(text) as unknown) : undefined };
}
