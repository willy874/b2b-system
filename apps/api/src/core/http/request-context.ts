import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  user?: { id: string; email: string };
  /**
   * 發起請求的分頁 instance id（`x-client-id`，已驗證格式）。
   * 只用來讓推播略過發起的分頁，**不做任何授權判斷**（docs/architecture/backend/08-realtime.md §7.1）。
   */
  clientId?: string;
  /**
   * 對外 API 以 API token 認證的請求（docs/architecture/06-external-api.md §9.2 D3）：`scopes` 是限縮後的權限鍵
   * （已含依賴樹的閉包）；undefined＝跟著帳號。`PermissionService` 對 `userId` 的權限一律與它取交集。
   */
  apiToken?: ContextApiToken;
}

export interface ContextApiToken {
  id: string;
  userId: string;
  scopes?: ReadonlySet<string>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** 當前請求的 `x-client-id`；沒帶或格式不合時為 undefined。 */
export function getClientId(): string | undefined {
  return storage.getStore()?.clientId;
}

/** 對外 API 認出 token 後補寫進當前 context（權限的交集、稽核的 `metadata.tokenId`）。 */
export function setContextApiToken(token: ContextApiToken): void {
  const context = storage.getStore();
  if (context) context.apiToken = token;
}

/** JwtAuthGuard 認出使用者後補寫進當前 context，讓稽核不必逐層傳遞。 */
export function setContextUser(user: { id: string; email: string }): void {
  const context = storage.getStore();
  if (context) context.user = user;
}
