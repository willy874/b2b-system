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
  /**
   * 請求是不是從 apps/platform 的網域進來（`TenantMiddleware` 依 Host 判斷）。平台管理者的端點只看這個，
   * 不以「沒有租戶」代替：未登記的網域、直接用 IP 連線也沒有租戶（docs/architecture/05-tenancy.md §2）。
   */
  platformHost?: boolean;
  /**
   * 這段執行期間每筆稽核都帶上的 metadata：背景工作代替使用者執行業務操作時標出來源，
   * 例：匯入的套用列寫 `{ via: 'import', transferId }`（docs/architecture/backend/22-data-transfer.md §12 D20）。
   */
  auditMetadata?: Readonly<Record<string, unknown>>;
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

/** 對外 API 認出 token 後補寫進當前 context（權限的交集、稽核的 `metadata.tokenId`）。 */
export function setContextApiToken(token: ContextApiToken): void {
  const context = storage.getStore();
  if (context) context.apiToken = token;
}

/** `TenantMiddleware` 以 Host 判斷後補寫進當前 context。 */
export function setContextPlatformHost(platformHost: boolean): void {
  const context = storage.getStore();
  if (context) context.platformHost = platformHost;
}

/** 這個請求是不是從 apps/platform 的網域進來；沒有請求脈絡（背景工作、WebSocket）時是 false。 */
export function isPlatformHostRequest(): boolean {
  return storage.getStore()?.platformHost === true;
}

/** JwtAuthGuard 認出使用者後補寫進當前 context，讓稽核不必逐層傳遞。 */
export function setContextUser(user: { id: string; email: string }): void {
  const context = storage.getStore();
  if (context) context.user = user;
}
