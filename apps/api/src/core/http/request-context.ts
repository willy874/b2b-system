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
  /** 批次端點執行期間由 `runBatch()` 帶入，稽核據此標記 `metadata.batch`（ADR-0009 D8）。 */
  batch?: { size: number };
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

/** JwtAuthGuard 認出使用者後補寫進當前 context，讓稽核不必逐層傳遞。 */
export function setContextUser(user: { id: string; email: string }): void {
  const context = storage.getStore();
  if (context) context.user = user;
}
