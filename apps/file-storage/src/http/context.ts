import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

import type { FileStorageConfig } from '@/config';
import { S3Error } from '@/s3/errors';
import type { DiskStore } from '@/storage/disk-store';

import type { Query } from './target';

/** 一個已通過簽章驗證的請求；handler 只透過它讀請求、寫回應。 */
export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  bucket: string | undefined;
  key: string | undefined;
  query: Query;
  headers: IncomingHttpHeaders;
  requestId: string;
  config: FileStorageConfig;
  store: DiskStore;
  /** 已依簽章方式解碼（aws-chunked）或驗證（SHA-256）過的 body。 */
  body: () => Readable;
}

export function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

export function requireBucketName(context: RequestContext): string {
  if (context.bucket === undefined) throw new S3Error('InvalidRequest', 'Missing bucket name.');
  return context.bucket;
}

export function requireKey(context: RequestContext): string {
  if (context.key === undefined) throw new S3Error('InvalidRequest', 'Missing object key.');
  return context.key;
}

export function sendXml(context: RequestContext, status: number, xml: string): void {
  const body = Buffer.from(xml, 'utf8');
  context.res.writeHead(status, {
    'Content-Type': 'application/xml',
    'Content-Length': body.length,
  });
  context.res.end(context.method === 'HEAD' ? undefined : body);
}

export function sendEmpty(
  context: RequestContext,
  status: number,
  headers: Record<string, string> = {},
): void {
  context.res.writeHead(status, { ...headers, 'Content-Length': 0 });
  context.res.end();
}
