import type { RequestInterceptor } from '../../client';
import { getTelemetryContext } from '../../telemetry';

/** 前端的 release（commit），api 的存取日誌記成 `clientRelease`（docs/architecture/frontend/19-observability.md §3）。 */
export const CLIENT_RELEASE_HEADER = 'x-client-release';

/**
 * 每個請求帶上前端的 release：後端日誌看得出請求來自哪一版的前端，部署後新舊版並存時也分得開。
 * 值在 `telemetryPlugin` 初始化時決定；之前（或測試）是 `dev`。
 */
export const clientReleaseInterceptor: RequestInterceptor = async (request) => {
  const headers = new Headers(request.init.headers);
  headers.set(CLIENT_RELEASE_HEADER, getTelemetryContext().release);
  return { ...request, init: { ...request.init, headers } };
};
