import { request } from '@playwright/test';

import { ACCOUNTS, E2E_PASSWORD } from '../fixtures/accounts';
import type { AccountKey } from '../fixtures/accounts';

/**
 * 經過 backstage 的 `/api` 代理打後端，跟瀏覽器一樣：api 以網域決定租戶
 * （docs/architecture/05-tenancy.md §10.2 D2），直接打 :3000 會找不到租戶。
 */
const API_BASE =
  process.env.E2E_API_URL ?? `${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/api`;

/** 直接打後端做前置準備（比走 UI 快且穩定）。 */
export async function apiLogin(account: AccountKey): Promise<string> {
  const context = await request.newContext();
  const response = await context.post(`${API_BASE}/auth/login`, {
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
  // 不用 baseURL：`new URL('/users', 'http://host/api')` 會把 /api 蓋掉
  const context = await request.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const response = await context[method](`${API_BASE}${path}`, data ? { data } : undefined);
  const text = await response.text();
  await context.dispose();
  return { status: response.status(), body: text ? (JSON.parse(text) as unknown) : undefined };
}

/** 對外 API 的程序（`pnpm dev:external-api`，docs/architecture/06-external-api.md）：只認 API token，租戶由 token 決定。 */
const EXTERNAL_API_URL = process.env.E2E_EXTERNAL_API_URL ?? 'http://localhost:3001';

export async function externalRequest(
  apiToken: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const context = await request.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${apiToken}` },
  });
  const response = await context.get(`${EXTERNAL_API_URL}${path}`);
  const text = await response.text();
  await context.dispose();
  return { status: response.status(), body: text ? (JSON.parse(text) as unknown) : undefined };
}
