import {
  browserTracingIntegration,
  getClient,
  startBrowserTracingNavigationSpan,
} from '@sentry/browser';
import type { Integration } from '@sentry/core';

/**
 * Web Vitals 與路由切換耗時（docs/architecture/frontend/19-observability.md §5）。另成一個模組，
 * 由 `initTelemetry` 以 `import()` 載入：取樣不到、或沒有 DSN 的分頁不下載這段程式。
 *
 * @param routeName 目前頁面的 path 樣板；載入時 router 可能還沒解析，由呼叫端提供後備值。
 */
export function createTracingIntegration(routeName: () => string): Integration {
  return browserTracingIntegration({
    // 導覽的 span 由 bindTelemetryRouter 以 path 樣板命名
    instrumentNavigation: false,
    traceFetch: false,
    traceXHR: false,
    enableLongTask: false,
    enableLongAnimationFrame: false,
    // 不用 sessionStorage 串前一個 trace（frontend/09-state-and-storage.md §4.2）
    linkPreviousTrace: 'off',
    beforeStartSpan: (context) => ({ ...context, name: routeName() }),
  });
}

/** 路由切換的 span（以 path 樣板命名）；由 `bindTelemetryRouter` 在 tracing 載入之後呼叫。 */
export function startNavigationSpan(name: string): void {
  const client = getClient();
  if (!client) return;
  startBrowserTracingNavigationSpan(client, {
    name,
    attributes: { 'sentry.source': 'route', 'sentry.op': 'navigation' },
  });
}
