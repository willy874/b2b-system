import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  user?: { id: string; email: string };
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

/** JwtAuthGuard 認出使用者後補寫進當前 context，讓稽核不必逐層傳遞。 */
export function setContextUser(user: { id: string; email: string }): void {
  const context = storage.getStore();
  if (context) context.user = user;
}
