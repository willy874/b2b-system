import { SetMetadata } from '@nestjs/common';

export const API_SURFACE = 'api:surface';

/**
 * 路由屬於哪一個入口（docs/architecture/06-external-api.md §9.2 D11）：
 * - `internal`（預設，不必標）：內部 api，給 backstage 與 apps/auth，認 JWT access token
 * - `external`：對外 API（另一個程序），只認 API token；路徑一律在 `/v1/` 底下
 * - `both`：兩邊都有（只給健康檢查）
 *
 * 兩個程序都會註冊所有 controller（Nest 的 controller 跟著 module 被 import），由 `SurfaceGuard` 讓另一邊的路由回 404。
 */
export type ApiSurface = 'internal' | 'external' | 'both';

/** 標在 controller（class）上。 */
export const Surface = (surface: Exclude<ApiSurface, 'internal'>) =>
  SetMetadata(API_SURFACE, surface);

/** 對外 API 的 controller：`@ExternalApi()` ＝ `@Surface('external')`。 */
export const ExternalApi = () => Surface('external');
