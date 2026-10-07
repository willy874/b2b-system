import {
  addBreadcrumb,
  breadcrumbsIntegration,
  browserApiErrorsIntegration,
  captureException,
  createTransport,
  dedupeIntegration,
  getActiveSpan,
  getClient,
  getRootSpan,
  globalHandlersIntegration,
  httpContextIntegration,
  init,
  lastEventId,
  linkedErrorsIntegration,
  setTag,
  setUser,
  spanToJSON,
  updateSpanName,
} from '@sentry/browser';
import type {
  Breadcrumb,
  BreadcrumbHint,
  ErrorEvent,
  EventHint,
  Integration,
  StreamedSpanJSON,
  TransactionEvent,
} from '@sentry/core';
import type { AnyRouter } from '@tanstack/react-router';

import { isNetworkError, isRequestAborted } from '../client';
import { AppError, isChunkLoadError } from '../errors';
import { scrubText, toPathTemplate } from './scrub';

/** 錯誤從哪裡來；上報時成為 tag `source`。 */
export type TelemetrySource =
  | 'window'
  | 'promise'
  | 'react'
  | 'query'
  | 'mutation'
  | 'worker'
  | 'manual';

export interface TelemetryOptions {
  /** 哪個前端：tag `app`，也是查詢時分辨專案的依據之一。 */
  app: string;
  /** 建置時注入的 commit（`__APP_RELEASE__`）。 */
  release: string;
  /** `import.meta.env.MODE`。 */
  environment: string;
  /** 完整的 DSN（接真的 Sentry 時用）；有值時優先於 `projectId` ＋ `publicKey`。 */
  dsn?: string | undefined;
  /** apps/apm-service 的專案 id 與 public key：DSN 在執行時以目前的網域組成（同源，docs/architecture/frontend/19-observability.md §9.2 D2）。 */
  projectId?: string | undefined;
  publicKey?: string | undefined;
  /** Web Vitals 的取樣率（0～1）；預設 0.1。沒有 DSN 時一律 0。 */
  tracesSampleRate?: number | undefined;
}

/** apps/apm-service 在 nginx 與 vite 底下的路徑前綴（deploy/nginx.conf 的 `/apm/`）。 */
export const APM_PATH_PREFIX = '/apm';
/** 同一個分頁一次載入最多上報幾個錯誤：迴圈裡的錯誤不灌爆收件端。 */
const MAX_ERRORS_PER_PAGE = 50;
/** 同一個錯誤（類型＋訊息）在同一個分頁每分鐘最多一次。 */
const DUPLICATE_WINDOW_MS = 60_000;
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
/** chunk 載入失敗（部署了新版）固定一組，不和程式錯誤混在一起（docs/architecture/frontend/19-observability.md §9.2 D8）。 */
export const CHUNK_LOAD_FINGERPRINT = 'chunk-load-error';
/** breadcrumb 只留這些分類：網路請求、我們自己加的導覽與推播。 */
const KEPT_BREADCRUMB_CATEGORIES = new Set(['fetch', 'xhr', 'navigation', 'realtime']);

interface TelemetryState {
  enabled: boolean;
  release: string;
  /** 目前頁面的 path 樣板（`/user/$userId`）。 */
  route: string | undefined;
  /** 這次載入的第一頁：頁面載入的 Web Vitals（LCP、CLS…）歸到它。 */
  pageloadRoute: string | undefined;
  errorsThisPage: number;
  recent: Map<string, number>;
}

/** tracing 載入之後才有（`import('./tracing')`）；取樣不到的分頁一直是 undefined。 */
let startNavigationSpan: ((name: string) => void) | undefined;

const state: TelemetryState = {
  enabled: false,
  release: 'dev',
  route: undefined,
  pageloadRoute: undefined,
  errorsThisPage: 0,
  recent: new Map(),
};

/** 依選項決定 DSN；都沒有時回 `undefined`（只 console.debug，docs/architecture/frontend/19-observability.md §9.2 D11）。 */
export function resolveDsn(
  options: Pick<TelemetryOptions, 'dsn' | 'projectId' | 'publicKey'>,
  location: Pick<Location, 'protocol' | 'host'> | undefined = globalThis.location,
): string | undefined {
  if (options.dsn) return options.dsn;
  if (!options.projectId || !options.publicKey || !location) return undefined;
  return `${location.protocol}//${options.publicKey}@${location.host}${APM_PATH_PREFIX}/${options.projectId}`;
}

/** 由 UI 處理、後端已有紀錄的錯誤：不上報（AppError 帶 requestId，後端日誌查得到）。 */
export function isExpectedError(error: unknown): boolean {
  return error instanceof AppError || isNetworkError(error) || isRequestAborted(error);
}

function errorKey(event: ErrorEvent): string {
  const exception = event.exception?.values?.at(-1);
  return `${exception?.type ?? ''}\n${exception?.value ?? event.message ?? ''}`;
}

/** 錯誤事件送出前（docs/architecture/frontend/19-observability.md §9.2 D7、D8）：遮罩、只留使用者 id、頁面換成樣板、去重與上限。 */
export function beforeSendError(
  event: ErrorEvent,
  hint: EventHint,
  now: number = Date.now(),
): ErrorEvent | null {
  if (state.errorsThisPage >= MAX_ERRORS_PER_PAGE) return null;
  const key = errorKey(event);
  const last = state.recent.get(key);
  if (last !== undefined && now - last < DUPLICATE_WINDOW_MS) return null;
  state.recent.set(key, now);
  state.errorsThisPage += 1;

  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = scrubText(exception.value);
  }
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.request) {
    const userAgent = event.request.headers?.['User-Agent'];
    event.request = {
      ...(event.request.url === undefined ? {} : { url: toPathTemplate(event.request.url) }),
      ...(userAgent === undefined ? {} : { headers: { 'User-Agent': userAgent } }),
    };
  }
  if (state.route !== undefined) event.transaction = state.route;
  delete event.extra;

  if (isChunkLoadError(hint.originalException)) {
    event.fingerprint = [CHUNK_LOAD_FINGERPRINT];
    event.level = 'warning';
    event.tags = { ...event.tags, kind: 'chunkLoad' };
  }
  return event;
}

/** transaction（Web Vitals）送出前：網址與 span 的描述一樣遮罩（伺服器端只取 Web Vitals，但內容仍離開了瀏覽器）。 */
export function beforeSendTransaction(event: TransactionEvent): TransactionEvent {
  if (event.request?.url !== undefined) event.request = { url: toPathTemplate(event.request.url) };
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  for (const span of event.spans ?? []) {
    if (span.description !== undefined) span.description = scrubText(span.description, 200);
  }
  return event;
}

/** span 只留 Web Vitals 用得到的屬性；其餘（元素選擇器、資源網址、元件名稱、User-Agent）丟掉。 */
const KEPT_SPAN_ATTRIBUTES = new Set([
  'sentry.op',
  'sentry.origin',
  'sentry.source',
  'sentry.segment.name',
  'sentry.segment.id',
  'sentry.transaction',
  'sentry.pageload.span_id',
  'sentry.exclusive_time',
  'sentry.sample_rate',
  'sentry.release',
  'sentry.environment',
  'sentry.sdk.name',
  'sentry.sdk.version',
  'browser.navigation.type',
]);
const WEB_VITAL_ATTRIBUTE = /^browser\.web_vital\.([a-z]+)\.value$/;
/** 頁面載入才有的指標：SDK 在換頁時才回報，會掛上「下一頁」的名稱，這裡改回載入的那一頁。INP 跟著互動當下的頁面。 */
const PAGELOAD_VITALS = new Set(['lcp', 'cls', 'fcp', 'ttfb']);

/**
 * span 送出前（SDK v11 預設以 span streaming 送出，`beforeSendTransaction` 不會被呼叫）：
 * 只留 Web Vitals 需要的屬性；名稱可能是元素選擇器，換成頁面樣板；頁面載入的指標歸回第一頁。
 */
export function beforeSendSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  const attributes: Record<string, unknown> = {};
  let vital: string | undefined;
  for (const [key, value] of Object.entries(span.attributes ?? {})) {
    const match = WEB_VITAL_ATTRIBUTE.exec(key);
    if (match) vital = match[1];
    if (match || KEPT_SPAN_ATTRIBUTES.has(key)) attributes[key] = value;
  }
  if (vital !== undefined && PAGELOAD_VITALS.has(vital) && state.pageloadRoute !== undefined) {
    attributes['sentry.segment.name'] = state.pageloadRoute;
    attributes['sentry.transaction'] = state.pageloadRoute;
  }
  const segment = attributes['sentry.segment.name'];
  const name =
    vital !== undefined && typeof segment === 'string' ? segment : scrubText(span.name, 200);
  return { ...span, name, attributes: attributes as StreamedSpanJSON['attributes'] };
}

/** breadcrumb：只留網路請求與導覽；網址換成樣板，補上後端的 requestId。 */
export function beforeBreadcrumb(breadcrumb: Breadcrumb, hint?: BreadcrumbHint): Breadcrumb | null {
  const category = breadcrumb.category ?? '';
  if (!KEPT_BREADCRUMB_CATEGORIES.has(category)) return null;
  if (category !== 'fetch' && category !== 'xhr') return breadcrumb;

  const data = breadcrumb.data ?? {};
  const url = typeof data.url === 'string' ? data.url : '';
  // 上報本身的請求不必記
  if (url.includes(`${APM_PATH_PREFIX}/api/`)) return null;
  const response = hint?.response as Response | undefined;
  const requestId = response?.headers?.get?.('x-request-id') ?? undefined;
  return {
    ...breadcrumb,
    data: {
      method: data.method,
      url: toPathTemplate(url),
      status_code: data.status_code,
      ...(requestId === undefined ? {} : { requestId }),
    },
  };
}

/** 沒有 DSN 時（開發）：要送的內容印到 console，不送出（docs/architecture/frontend/19-observability.md §9.2 D11）。 */
function consoleTransport(options: Parameters<typeof createTransport>[0]) {
  return createTransport(options, async (request) => {
    // oxlint-disable-next-line no-console -- 開發時看得到會送出什麼；正式環境有 DSN，不走這裡
    console.debug('[telemetry] 未設定 DSN，不送出', request.body);
    return { statusCode: 200 };
  });
}

/**
 * 初始化錯誤回報（docs/architecture/frontend/19-observability.md）。由 `telemetryPlugin` 在最早的時間點呼叫。
 * 不用 SDK 的預設整合清單：DOM 點擊、console、history 的 breadcrumb 會帶出畫面文字與真實網址。
 */
export function initTelemetry(options: TelemetryOptions): void {
  if (state.enabled) return;
  const dsn = resolveDsn(options);
  const tracesSampleRate = dsn ? (options.tracesSampleRate ?? DEFAULT_TRACES_SAMPLE_RATE) : 0;
  const integrations: Integration[] = [
    globalHandlersIntegration(),
    browserApiErrorsIntegration(),
    linkedErrorsIntegration(),
    dedupeIntegration(),
    httpContextIntegration(),
    breadcrumbsIntegration({ dom: false, history: false, sentry: false, xhr: true, fetch: true }),
  ];
  init({
    // 沒有 DSN 時給一個不會被連線的 DSN，讓 SDK 照常處理事件，再由 consoleTransport 印出
    dsn: dsn ?? 'http://dev@localhost/0',
    ...(dsn ? {} : { transport: consoleTransport }),
    release: options.release,
    environment: options.environment,
    // 不自動帶使用者資訊、cookie、標頭（User-Agent 除外）、body、query string（docs/architecture/frontend/19-observability.md §9.2 D7）
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    defaultIntegrations: false,
    integrations,
    tracesSampleRate,
    // 不在我們的 API 請求上加 sentry-trace／baggage 標頭
    tracePropagationTargets: [],
    maxBreadcrumbs: 30,
    beforeSend: (event, hint) => beforeSendError(event, hint),
    // v11 預設以 span streaming 送出：Web Vitals 走 beforeSendSpan；beforeSendTransaction 只在 traceLifecycle: 'static' 時有作用
    beforeSendSpan,
    beforeSendTransaction,
    beforeBreadcrumb,
    // host：租戶由網域決定（docs/architecture/05-tenancy.md），查詢時以它分辨是哪個租戶遇到的
    initialScope: { tags: { app: options.app, host: globalThis.location?.host ?? '' } },
  });
  state.enabled = true;
  state.release = options.release;

  if (tracesSampleRate > 0) {
    // 動態載入：tracing 的程式不進入首頁的 chunk（F2 的 bundle 預算）。pageload 的起點取自
    // performance 的 timeOrigin，晚一點加入整合不影響量測
    void import('./tracing').then((tracing) => {
      getClient()?.addIntegration(
        tracing.createTracingIntegration(
          () => state.route ?? toPathTemplate(globalThis.location.href),
        ),
      );
      startNavigationSpan = tracing.startNavigationSpan;
    });
  }
}

/** 上報一個錯誤；回傳事件 id（未初始化時 `undefined`）。 */
export function captureError(
  error: unknown,
  source: TelemetrySource,
  handled = true,
): string | undefined {
  if (!state.enabled) return undefined;
  return captureException(error, {
    captureContext: { tags: { source } },
    mechanism: { type: source, handled },
  });
}

/** profile 載入或登出時呼叫：只帶 id（docs/architecture/frontend/19-observability.md §9.2 D7）。 */
export function setTelemetryUser(id: string | undefined): void {
  if (!state.enabled) return;
  setUser(id === undefined ? null : { id });
}

/** 加一則自訂的 breadcrumb（例：即時推播的斷線）；文字會遮罩。 */
export function addTelemetryBreadcrumb(
  category: 'navigation' | 'realtime',
  message: string,
  data?: Record<string, string>,
): void {
  if (!state.enabled) return;
  addBreadcrumb({ category, message: scrubText(message, 200), ...(data ? { data } : {}) });
}

function routeTemplateOf(router: AnyRouter, pathname: string): string {
  return router.matchRoutes(pathname).at(-1)?.fullPath ?? toPathTemplate(pathname);
}

/**
 * 頁面的 path 樣板：錯誤事件的 `transaction`、tag `route`、導覽的 breadcrumb，以及 Web Vitals 的頁面
 * （docs/architecture/frontend/19-observability.md §9.2 D10）。router 建立之後呼叫一次；回傳取消訂閱的函式。
 */
export function bindTelemetryRouter(router: AnyRouter): () => void {
  const apply = (pathname: string): string => {
    const route = routeTemplateOf(router, pathname);
    state.route = route;
    if (state.enabled) setTag('route', route);
    return route;
  };

  const initial = apply(router.state.location.pathname);
  state.pageloadRoute = initial;
  // 載入時的 pageload span 以 pathname 命名，這裡改成樣板
  const active = getActiveSpan();
  const root = active ? getRootSpan(active) : undefined;
  if (root && spanToJSON(root).attributes['sentry.op'] === 'pageload') {
    updateSpanName(root, initial);
    root.setAttribute('sentry.source', 'route');
  }

  // 同一次換頁 router 可能發出不只一次 onBeforeNavigate（前一次還沒 resolve 時 pathChanged 仍是 true）：以目的地去重
  let lastHref: string | undefined;
  return router.subscribe('onBeforeNavigate', (event) => {
    // 第一次載入（沒有 fromLocation）由 pageload 涵蓋，不算換頁
    if (!event.pathChanged || event.fromLocation === undefined) return;
    if (event.toLocation.href === lastHref) return;
    lastHref = event.toLocation.href;
    const from = state.route;
    const to = apply(event.toLocation.pathname);
    if (!state.enabled) return;
    addBreadcrumb({ category: 'navigation', data: { from: from ?? '', to } });
    startNavigationSpan?.(to);
  });
}

/** 「複製錯誤資訊」需要的內容。 */
export interface TelemetryContext {
  /** 最近一次上報的事件 id。 */
  eventId: string | undefined;
  release: string;
  route: string | undefined;
}

export function getTelemetryContext(): TelemetryContext {
  return {
    eventId: state.enabled ? lastEventId() : undefined,
    release: state.release,
    route: state.route,
  };
}

/**
 * 交給 `createRoot(container, …)`：React 19 的錯誤回呼（設計決策：TanStack Router 的錯誤邊界也是 React 的錯誤邊界，
 * `onCaughtError` 會收到路由頁面 render 時的錯誤，`RouteErrorPage` 不必自己上報）。
 */
export function telemetryRootOptions(): {
  onUncaughtError: (error: unknown) => void;
  onCaughtError: (error: unknown) => void;
  onRecoverableError: (error: unknown) => void;
} {
  return {
    onUncaughtError: (error) => {
      captureError(error, 'react', false);
      // oxlint-disable-next-line no-console -- 取代 React 預設的回呼後，保留它原本的 console 輸出
      console.error(error);
    },
    onCaughtError: (error) => {
      captureError(error, 'react');
      // oxlint-disable-next-line no-console -- 同上
      console.error(error);
    },
    onRecoverableError: (error) => {
      captureError(error, 'react');
    },
  };
}

/** 測試用：回到未初始化的狀態（不會解除 SDK 的全域攔截）。 */
export function resetTelemetryStateForTest(): void {
  state.enabled = false;
  state.release = 'dev';
  state.route = undefined;
  state.pageloadRoute = undefined;
  state.errorsThisPage = 0;
  state.recent.clear();
  startNavigationSpan = undefined;
}
