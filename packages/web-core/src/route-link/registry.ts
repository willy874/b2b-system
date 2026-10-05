import { createRegistry } from '@b2b-system/web-shared/registry';

import { routeBasePath } from '../permission';

/**
 * route id → route 的註冊表（docs/architecture/frontend/15-notification.md §3、docs/architecture/backend/15-notification.md §12.2 D3）。
 *
 * 後端把連結存成 `{ route: '<route id>', params }`（例：站內通知的 `link`），而不是路徑字串：路由改名或搬移時，
 * 只要擁有頁面的 feature 改註冊，舊資料照樣連得到。feature 在 plugin 的 **同步** 階段登記自己的頁面；
 * 讀的一方（例：`features/notification`）只查這張表，不 import 其他 feature 的 route。
 */

/** 後端 `notification.definition.ts` 的 `ROUTE_ID_PATTERN`：`<feature>.<頁面>`，可再多層，camelCase。 */
const ROUTE_ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

/** 連結帶來的參數（後端的 `link.params`）。 */
export type RouteLinkParams = Readonly<Record<string, unknown>>;

/** 後端存的連結；`null`／`undefined` 代表沒有連結。 */
export interface RouteLinkRef {
  route: string;
  params: RouteLinkParams;
}

export interface RouteLinkDefinition {
  /** 目標 route 物件（`createRoute` 的回傳值）；只讀它的 path，不 import 頁面元件。 */
  route: unknown;
  /**
   * route 的 path 參數 ← 連結參數的名稱，例：`{ approvalId: 'approvalId' }`。
   * 都是必要的：連結缺任何一個就解析不出來（不可點）。
   */
  params?: Readonly<Record<string, string>>;
  /** 網址 search 參數 ← 連結參數的名稱，例：`{ folder: 'folderId' }`。同樣都是必要的。 */
  search?: Readonly<Record<string, string>>;
}

/** 可以直接交給 TanStack Router（`<Link>`、`navigate()`）的目標。 */
export interface ResolvedRouteLink {
  /** route 的完整 path 樣板，例：`/approval/$approvalId`。 */
  to: string;
  params: Record<string, string>;
  search: Record<string, string>;
}

interface RouteLinkEntry {
  path: string;
  params: Readonly<Record<string, string>>;
  search: Readonly<Record<string, string>>;
}

/** 可訂閱：可啟用的 feature（例：檔案）安裝或卸載時，連結跟著變成可點或不可點（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
export const routeLinkRegistry = createRegistry<string, RouteLinkEntry>('Route link');

/**
 * 在 plugin 的同步階段登記（與 `registerPagePermission` 同一處）。回傳反註冊函式；在 factory 裡呼叫時由容器收集。
 * id 已發出給後端就 **不改名**：舊資料靠它連結。格式不對、`params` 對不上 path 的 `$參數` 是程式錯誤，直接丟例外。
 */
export function registerRouteLink(id: string, definition: RouteLinkDefinition): () => void {
  if (!ROUTE_ID_PATTERN.test(id)) throw new Error(`route id 格式不對：${id}`);
  const path = routeBasePath(definition.route);
  const params = definition.params ?? {};
  const pathParams = [...path.matchAll(/\$([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const declared = Object.keys(params);
  const missing = pathParams.filter((name) => name !== undefined && !declared.includes(name));
  const extra = declared.filter((name) => !pathParams.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`route link ${id} 的 params 與 path ${path} 對不上`);
  }
  return routeLinkRegistry.register(id, { path, params, search: definition.search ?? {} });
}

/** 把連結參數依對照表取出；任何一個缺少、不是字串或是空字串就回 undefined。 */
function pick(
  mapping: Readonly<Record<string, string>>,
  params: RouteLinkParams,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [target, source] of Object.entries(mapping)) {
    const value = params[source];
    if (typeof value !== 'string' || value === '') return undefined;
    result[target] = value;
  }
  return result;
}

/**
 * 解析一個連結；沒有連結、route id 沒有登記（所屬 feature 沒安裝或已改名）、缺少必要參數時回 undefined
 * ——呼叫端只顯示文字、不可點（docs/architecture/backend/15-notification.md §12.2 D3）。多出來的參數忽略。
 */
export function resolveRouteLink(
  link: RouteLinkRef | null | undefined,
  entries: ReadonlyMap<string, RouteLinkEntry> = routeLinkRegistry.store.getState().entries,
): ResolvedRouteLink | undefined {
  if (!link) return undefined;
  const entry = entries.get(link.route);
  if (!entry) return undefined;
  const params = pick(entry.params, link.params);
  const search = pick(entry.search, link.params);
  if (!params || !search) return undefined;
  return { to: entry.path, params, search };
}

/** 測試用。 */
export function resetRouteLinkRegistry(): void {
  routeLinkRegistry.reset();
}
