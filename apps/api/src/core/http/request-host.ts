import type { IncomingHttpHeaders } from 'node:http';

/** Express 由 `trust proxy` 編譯出的判定函式（`app.get('trust proxy fn')`）。 */
export type TrustProxyFn = (address: string, hop: number) => boolean;

/**
 * 瀏覽器看到的 host（含 port，小寫）：直接的上一跳是受信任的代理時讀 `X-Forwarded-Host`，
 * 否則讀 `Host`。規則同 Express 5 的 `req.host`；WebSocket 的 handshake 沒有 Express 的 req，
 * 所以抽成共用函式（docs/architecture/05-tenancy.md §10.2 D2）。
 */
export function requestHost(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trust: TrustProxyFn,
): string | undefined {
  const forwarded = headers['x-forwarded-host'];
  const raw =
    forwarded && remoteAddress && trust(remoteAddress, 0)
      ? Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded
      : headers.host;
  const host = raw?.split(',')[0]?.trim().toLowerCase();
  return host || undefined;
}

/** `host` 去掉 port（IPv6 的 `[::1]:5173` → `[::1]`）；沒有 port 時回傳原值。 */
export function hostnameOf(host: string): string {
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host);
  return match?.[1] ?? host;
}
