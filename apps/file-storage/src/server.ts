import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

import { authenticate } from '@/auth/sigv4';
import type { FileStorageConfig } from '@/config';
import { openBody } from '@/http/body';
import { header } from '@/http/context';
import { parseTarget } from '@/http/target';
import { log } from '@/log';
import { resolveRoute } from '@/router';
import { isS3Error, S3Error } from '@/s3/errors';
import { plainXmlDocument, text } from '@/s3/xml';
import type { DiskStore } from '@/storage/disk-store';

export interface FileStorageServerOptions {
  config: FileStorageConfig;
  store: DiskStore;
  /** 每個請求記一行存取日誌；測試關掉以免洗版。 */
  isAccessLogEnabled?: boolean;
}

/** 瀏覽器端（presigned URL 直傳 / 下載）需要讀到的回應標頭。 */
const EXPOSED_HEADERS = [
  'ETag',
  'Content-Length',
  'Content-Type',
  'Content-Range',
  'Last-Modified',
  'x-amz-request-id',
  'x-amz-id-2',
].join(', ');

const PREFLIGHT_MAX_AGE_SECONDS = 3000;

function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes('*') || allowed.includes(origin);
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowed: readonly string[]): void {
  const origin = header(req.headers, 'origin');
  if (origin === undefined || !isOriginAllowed(origin, allowed)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  res.setHeader('Vary', 'Origin');
}

/** CORS preflight 不帶簽章，依 `FILE_STORAGE_ALLOWED_ORIGINS` 決定放行與否。 */
function handlePreflight(
  req: IncomingMessage,
  res: ServerResponse,
  allowed: readonly string[],
): void {
  const origin = header(req.headers, 'origin');
  if (origin === undefined || !isOriginAllowed(origin, allowed)) {
    throw new S3Error('AccessDenied', 'CORSResponse: This CORS request is not allowed.');
  }
  res.writeHead(200, {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD',
    'Access-Control-Allow-Headers': header(req.headers, 'access-control-request-headers') ?? '',
    'Access-Control-Max-Age': PREFLIGHT_MAX_AGE_SECONDS,
    'Content-Length': 0,
  });
  res.end();
}

function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  error: unknown,
  resource: string,
  requestId: string,
): void {
  const s3Error = isS3Error(error) ? error : new S3Error('InternalError');
  if (!isS3Error(error)) {
    log.error('未預期的錯誤', {
      requestId,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    });
  }
  // 回應已經開始（例如 GetObject 串流到一半讀檔失敗）就只能斷線，讓客戶端知道內容不完整
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // body 還沒讀完就回錯誤（簽章錯、物件太大…）時關閉連線，不為了 keep-alive 把整個 body 讀完
  if (!req.complete) res.setHeader('Connection', 'close');

  const xml = Buffer.from(
    plainXmlDocument('Error', [
      text('Code', s3Error.code),
      text('Message', s3Error.message),
      ...Object.entries(s3Error.details).map(([name, value]) => text(name, value)),
      text('Resource', resource),
      text('RequestId', requestId),
    ]),
    'utf8',
  );
  res.writeHead(s3Error.status, {
    'Content-Type': 'application/xml',
    'Content-Length': xml.length,
  });
  res.end(req.method === 'HEAD' ? undefined : xml);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: FileStorageServerOptions,
): Promise<void> {
  const { config, store } = options;
  const startedAt = performance.now();
  const requestId = randomBytes(8).toString('hex').toUpperCase();
  const method = req.method ?? 'GET';
  let operation = 'Unknown';
  let resource = '/';

  res.setHeader('x-amz-request-id', requestId);
  res.setHeader('x-amz-id-2', requestId);
  if (options.isAccessLogEnabled ?? true) {
    res.on('close', () => {
      log.info('request', {
        requestId,
        method,
        path: resource,
        operation,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  }

  try {
    applyCors(req, res, config.allowedOrigins);
    if (method === 'OPTIONS') {
      operation = 'Preflight';
      handlePreflight(req, res, config.allowedOrigins);
      return;
    }

    const target = parseTarget(req.url ?? '/');
    resource = target.rawPath;
    const payload = authenticate(
      { method, rawPath: target.rawPath, query: target.query, headers: req.headers },
      config.credentials,
    );
    const route = resolveRoute(
      method,
      target,
      header(req.headers, 'x-amz-copy-source') !== undefined,
    );
    operation = route.operation;

    let body: Readable | undefined;
    await route.handler({
      req,
      res,
      method,
      bucket: target.bucket,
      key: target.key,
      query: target.query,
      headers: req.headers,
      requestId,
      config,
      store,
      body: () => (body ??= openBody(req, payload)),
    });
  } catch (error) {
    sendError(req, res, error, resource, requestId);
  }
}

/**
 * 建立 S3 相容的 HTTP 伺服器（path-style、SigV4）。
 * 支援的操作清單見 docs/architecture/03-file-storage.md §4。
 */
export function createFileStorageServer(options: FileStorageServerOptions): Server {
  return createServer((req, res) => {
    void handle(req, res, options);
  });
}
