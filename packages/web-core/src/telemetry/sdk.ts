/**
 * Sentry SDK 用到的函式（docs/architecture/frontend/19-observability.md §2.1）：只由 `telemetry.ts` 以 `import()` 載入，
 * SDK 不進首頁的初始載入。具名轉出：`import('@sentry/browser')` 整個命名空間會把 replay、feedback 一起帶進來。
 * 以值匯入 `@sentry/*` 的只有這個檔案與 `tracing.ts`（`__tests__/sdk-boundary.test.ts`）。
 */
export {
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
