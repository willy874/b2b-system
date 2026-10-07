import type { IncomingMessage } from 'node:http';

/** 前端的 release 是 commit 的前幾碼或 `dev`；只接受這個形狀，避免任意字串進日誌。 */
const RELEASE_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * 請求的 `x-client-release`（前端建置時寫入的 release，docs/architecture/frontend/19-observability.md §3）。
 * 存取日誌記成 `clientRelease`，部署後新舊版前端並存時分得出是哪一版發的請求。
 */
export function clientReleaseOf(req: IncomingMessage): string | undefined {
  const value = req.headers['x-client-release'];
  return typeof value === 'string' && RELEASE_PATTERN.test(value) ? value : undefined;
}
