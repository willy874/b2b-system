import type {
  BaseTransportOptions,
  Breadcrumb,
  BreadcrumbHint,
  ErrorEvent,
  EventHint,
  Integration,
  StreamedSpanJSON,
  TransactionEvent,
  Transport,
} from '@sentry/core';
import type { AnyRouter } from '@tanstack/react-router';

import { isNetworkError, isRequestAborted } from '../client';
import { AppError, isChunkLoadError } from '../errors';
import { scrubText, toPathTemplate } from './scrub';
import type * as SdkModule from './sdk';

type Sdk = typeof SdkModule;

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
  /**
   * APM 整套的開關（`VITE_APM_ENABLED`；docs/architecture/frontend/19-observability.md §8）。`false` 時完全不初始化 SDK：
   * 不送出、也不印到 console，`captureError` 等函式都是空操作。預設 `true`。
   */
  enabled?: boolean | undefined;
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

/** SDK 就緒前最多暫存幾個錯誤：啟動過程卡在迴圈時不無限累積。 */
const MAX_PENDING_ERRORS = 20;
/** 與 SDK 的 `maxBreadcrumbs` 相同。 */
const MAX_BREADCRUMBS = 30;

interface PendingError {
  error: unknown;
  source: TelemetrySource;
  handled: boolean;
}

/**
 * SDK 以 `import('./sdk')` 載入（docs/architecture/frontend/19-observability.md §9.2 D13）：`initTelemetry` 立刻開始下載，
 * 就緒前的錯誤、使用者、breadcrumb 先放在這裡，就緒後依序補上。
 */
const pending = {
  sdk: undefined as Sdk | undefined,
  ready: undefined as Promise<void> | undefined,
  errors: [] as PendingError[],
  breadcrumbs: [] as Breadcrumb[],
  /** `null` 是登出；`undefined` 是就緒前沒有呼叫過。 */
  user: undefined as { id: string } | null | undefined,
  /** 就緒前的全域攔截；SDK 的 `globalHandlersIntegration` 接手後移除。 */
  removeEarlyHandlers: undefined as (() => void) | undefined,
};

function queueError(error: unknown, source: TelemetrySource, handled: boolean): void {
  if (pending.errors.length < MAX_PENDING_ERRORS) pending.errors.push({ error, source, handled });
}

function queueWindowError(event: Event): void {
  // 圖片等資源載入失敗也會發 error（不是 ErrorEvent），SDK 的全域攔截同樣不處理
  if (!('message' in event)) return;
  const { error, message } = event as globalThis.ErrorEvent;
  queueError(error ?? message, 'window', false);
}

function queueRejection(event: PromiseRejectionEvent): void {
  queueError(event.reason, 'promise', false);
}

/** 就緒前的全域攔截：只做 SDK 的 `globalHandlersIntegration` 會做的事（未處理的例外與 rejection）。 */
function installEarlyHandlers(): () => void {
  const target = globalThis as Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>;
  if (!target.addEventListener || !target.removeEventListener) return () => {};
  target.addEventListener('error', queueWindowError);
  target.addEventListener('unhandledrejection', queueRejection);
  return () => {
    target.removeEventListener?.('error', queueWindowError);
    target.removeEventListener?.('unhandledrejection', queueRejection);
  };
}

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
function consoleTransport(sdk: Sdk) {
  return (options: BaseTransportOptions): Transport =>
    sdk.createTransport(options, async (request) => {
      // oxlint-disable-next-line no-console -- 開發時看得到會送出什麼；正式環境有 DSN，不走這裡
      console.debug('[telemetry] 未設定 DSN，不送出', request.body);
      return { statusCode: 200 };
    });
}

/**
 * 初始化錯誤回報（docs/architecture/frontend/19-observability.md）。由 `telemetryPlugin` 在最早的時間點呼叫。
 * SDK 在這裡開始下載（不等登入、不等 idle），與 router 建立、第一次 render 並行；就緒前的錯誤先暫存（§9.2 D13）。
 * 不用 SDK 的預設整合清單：DOM 點擊、console、history 的 breadcrumb 會帶出畫面文字與真實網址。
 */
export function initTelemetry(options: TelemetryOptions): void {
  if (state.enabled || options.enabled === false) return;
  state.enabled = true;
  state.release = options.release;
  pending.removeEarlyHandlers = installEarlyHandlers();
  pending.ready = import('./sdk').then(
    (sdk) => startSdk(sdk, options),
    () => {
      // chunk 載入失敗（多半是部署換版）：暫存的錯誤送不出去，與 SDK 本身載入失敗時相同
      pending.removeEarlyHandlers?.();
      pending.removeEarlyHandlers = undefined;
      pending.errors = [];
      pending.breadcrumbs = [];
    },
  );
}

function startSdk(sdk: Sdk, options: TelemetryOptions): void {
  const dsn = resolveDsn(options);
  const tracesSampleRate = dsn ? (options.tracesSampleRate ?? DEFAULT_TRACES_SAMPLE_RATE) : 0;
  const integrations: Integration[] = [
    sdk.globalHandlersIntegration(),
    sdk.browserApiErrorsIntegration(),
    sdk.linkedErrorsIntegration(),
    sdk.dedupeIntegration(),
    sdk.httpContextIntegration(),
    sdk.breadcrumbsIntegration({
      dom: false,
      history: false,
      sentry: false,
      xhr: true,
      fetch: true,
    }),
  ];
  sdk.init({
    // 沒有 DSN 時給一個不會被連線的 DSN，讓 SDK 照常處理事件，再由 consoleTransport 印出
    dsn: dsn ?? 'http://dev@localhost/0',
    ...(dsn ? {} : { transport: consoleTransport(sdk) }),
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
    maxBreadcrumbs: MAX_BREADCRUMBS,
    beforeSend: (event, hint) => beforeSendError(event, hint),
    // v11 預設以 span streaming 送出：Web Vitals 走 beforeSendSpan；beforeSendTransaction 只在 traceLifecycle: 'static' 時有作用
    beforeSendSpan,
    beforeSendTransaction,
    beforeBreadcrumb,
    // host：租戶由網域決定（docs/architecture/05-tenancy.md），查詢時以它分辨是哪個租戶遇到的
    initialScope: { tags: { app: options.app, host: globalThis.location?.host ?? '' } },
  });
  pending.removeEarlyHandlers?.();
  pending.removeEarlyHandlers = undefined;
  pending.sdk = sdk;

  // 就緒前的內容依發生順序補上：先情境（頁面、使用者、breadcrumb），再錯誤
  if (state.route !== undefined) sdk.setTag('route', state.route);
  if (pending.user !== undefined) sdk.setUser(pending.user);
  for (const breadcrumb of pending.breadcrumbs) sdk.addBreadcrumb(breadcrumb);
  for (const { error, source, handled } of pending.errors) {
    sdk.captureException(error, {
      captureContext: { tags: { source } },
      mechanism: { type: source, handled },
    });
  }
  pending.errors = [];
  pending.breadcrumbs = [];
  pending.user = undefined;

  if (tracesSampleRate > 0) {
    // 動態載入：tracing 的程式不進入首頁的 chunk（F2 的 bundle 預算）。pageload 的起點取自
    // performance 的 timeOrigin，晚一點加入整合不影響量測
    void import('./tracing').then((tracing) => {
      sdk
        .getClient()
        ?.addIntegration(
          tracing.createTracingIntegration(
            () => state.route ?? toPathTemplate(globalThis.location.href),
          ),
        );
      startNavigationSpan = tracing.startNavigationSpan;
    });
  }
}

/** SDK 載入並初始化完成（或載入失敗）時 resolve；沒有初始化時立即 resolve。給測試與需要等事件 id 的地方。 */
export function telemetryReady(): Promise<void> {
  return pending.ready ?? Promise.resolve();
}

/** 上報一個錯誤；回傳事件 id（未初始化、SDK 還沒就緒時 `undefined`，就緒後補送）。 */
export function captureError(
  error: unknown,
  source: TelemetrySource,
  handled = true,
): string | undefined {
  if (!state.enabled) return undefined;
  if (!pending.sdk) {
    queueError(error, source, handled);
    return undefined;
  }
  return pending.sdk.captureException(error, {
    captureContext: { tags: { source } },
    mechanism: { type: source, handled },
  });
}

/** profile 載入或登出時呼叫：只帶 id（docs/architecture/frontend/19-observability.md §9.2 D7）。 */
export function setTelemetryUser(id: string | undefined): void {
  if (!state.enabled) return;
  const user = id === undefined ? null : { id };
  if (pending.sdk) pending.sdk.setUser(user);
  else pending.user = user;
}

/** 加一則自訂的 breadcrumb（例：即時推播的斷線）；文字會遮罩。 */
export function addTelemetryBreadcrumb(
  category: 'navigation' | 'realtime',
  message: string,
  data?: Record<string, string>,
): void {
  if (!state.enabled) return;
  addBreadcrumbOrQueue({ category, message: scrubText(message, 200), ...(data ? { data } : {}) });
}

function addBreadcrumbOrQueue(breadcrumb: Breadcrumb): void {
  if (pending.sdk) {
    pending.sdk.addBreadcrumb(breadcrumb);
    return;
  }
  // SDK 就緒後才套用 beforeBreadcrumb；這裡只放我們自己加的分類（導覽、推播），不必先過濾
  pending.breadcrumbs.push({ timestamp: Date.now() / 1000, ...breadcrumb });
  if (pending.breadcrumbs.length > MAX_BREADCRUMBS) pending.breadcrumbs.shift();
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
    // SDK 還沒就緒時，就緒後以當時的 state.route 補上
    pending.sdk?.setTag('route', route);
    return route;
  };

  const initial = apply(router.state.location.pathname);
  state.pageloadRoute = initial;
  // 載入時的 pageload span 以 pathname 命名，這裡改成樣板（tracing 晚於這裡載入時，span 一開始就以 state.route 命名）
  const sdk = pending.sdk;
  const active = sdk?.getActiveSpan();
  const root = active ? sdk?.getRootSpan(active) : undefined;
  if (sdk && root && sdk.spanToJSON(root).attributes['sentry.op'] === 'pageload') {
    sdk.updateSpanName(root, initial);
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
    addBreadcrumbOrQueue({ category: 'navigation', data: { from: from ?? '', to } });
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
    eventId: pending.sdk?.lastEventId(),
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
  pending.removeEarlyHandlers?.();
  pending.removeEarlyHandlers = undefined;
  pending.sdk = undefined;
  pending.ready = undefined;
  pending.errors = [];
  pending.breadcrumbs = [];
  pending.user = undefined;
}
