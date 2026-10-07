import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { ApmServices } from '@/context';
import { header } from '@/context';
import { ApmError, isApmError } from '@/http/errors';
import { sendJson } from '@/http/respond';
import { authenticateApi } from '@/ingest/auth';
import { log } from '@/log';
import { resolveRoute } from '@/router';

export interface ApmServerOptions {
  services: ApmServices;
  /** 每個請求記一行存取日誌；測試關掉以免洗版。 */
  isAccessLogEnabled?: boolean;
}

function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  error: unknown,
  requestId: string,
): void {
  const apmError = isApmError(error) ? error : new ApmError(500, '內部錯誤');
  if (!isApmError(error)) {
    log.error('未預期的錯誤', {
      requestId,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    });
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // body 還沒讀完就回錯誤（太大、驗證失敗）時關閉連線，不為了 keep-alive 把整個 body 讀完
  if (!req.complete) res.setHeader('Connection', 'close');
  sendJson(res, apmError.status, { detail: apmError.detail }, apmError.headers);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: ApmServerOptions,
): Promise<void> {
  const { services } = options;
  const startedAt = performance.now();
  const requestId = randomBytes(8).toString('hex');
  const method = req.method ?? 'GET';
  let operation = 'Unknown';
  const url = new URL(req.url ?? '/', 'http://apm.invalid');

  res.setHeader('x-request-id', requestId);
  if (options.isAccessLogEnabled ?? true) {
    res.on('close', () => {
      // 存活與指標每幾秒一次，不記
      if (operation === 'Health' || operation === 'Metrics') return;
      log.info('request', {
        requestId,
        method,
        // 不記 query：收件端點的 query 帶 sentry_key
        path: url.pathname,
        operation,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  }

  try {
    const resolved = resolveRoute(method, url.pathname);
    if (!('route' in resolved)) {
      throw resolved.methodNotAllowed
        ? new ApmError(405, '不支援這個方法')
        : new ApmError(404, '找不到這個端點');
    }
    operation = resolved.route.operation;
    if (resolved.route.auth === 'token') {
      authenticateApi(header(req, 'authorization'), services.config.authToken);
    }
    await resolved.route.handler({ req, res, url, params: resolved.params, requestId, services });
  } catch (error) {
    sendError(req, res, error, requestId);
  }
}

/**
 * 模擬 Sentry API 的 HTTP 伺服器。支援的端點見 docs/architecture/07-apm-service.md。
 */
export function createApmServer(options: ApmServerOptions): Server {
  return createServer((req, res) => {
    void handle(req, res, options);
  });
}
