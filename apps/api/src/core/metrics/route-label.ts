import type { IncomingMessage } from 'node:http';

/** 沒有對應到任何路由的請求（404）：路徑由客戶端決定，不能當標籤。 */
export const UNMATCHED_ROUTE = 'unmatched';
/** 由掛載的子應用程式處理、又不是 404（例：OIDC Provider 的 `/oidc/*`）但沒有 baseUrl 可用。 */
export const OTHER_ROUTE = 'other';

/**
 * 路由的標籤（指標的 `route`、trace 的 `http.route`）：Express 對到的路由樣板（`/users/:id`），不用實際的網址——網址帶 id，每個值都是一條新的時間序列。
 * 掛載在前綴下的子應用程式（OIDC Provider）只取掛載點（`req.baseUrl`）。
 */
/**
 * 萬用路由（`consumer.apply(...).forRoutes('*')` 在 Nest 12 的 Express 5 變成 `{/*splat}`；也接受 `*`、`/{*splat}` 的寫法）：
 * 中介軟體也會把它留在 `req.route`，沒有對到任何 controller 的請求最後帶著的就是它，不是真正的路由。
 */
const CATCH_ALL = /^\/?(\*|\{\/?\*\w*\})$/;

export function routeLabelOf(req: IncomingMessage, status: number): string {
  // Express 在對到路由時把 `route`、`baseUrl` 掛在同一個請求物件上；這裡只依賴 node:http 的型別，
  // tracing（src/instrumentation.ts）在 Express 載入之前就要用它
  const { route, baseUrl } = req as IncomingMessage & {
    route?: { path?: unknown };
    baseUrl?: string;
  };
  const template = route?.path;
  if (typeof template === 'string' && !CATCH_ALL.test(template)) {
    return `${baseUrl ?? ''}${template}` || '/';
  }
  if (baseUrl) return baseUrl;
  return status === 404 ? UNMATCHED_ROUTE : OTHER_ROUTE;
}
