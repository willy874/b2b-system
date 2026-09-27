import type { IncomingHttpHeaders } from 'node:http';

import { header } from '@/http/context';
import type { Conditions } from '@/s3/conditions';
import { S3Error } from '@/s3/errors';

/**
 * body 的實際長度：aws-chunked 時看 `x-amz-decoded-content-length`（`Content-Length` 含了分塊標記），
 * 否則看 `Content-Length`。兩者都沒有（Transfer-Encoding: chunked）時回 undefined。
 */
export function declaredBodySize(headers: IncomingHttpHeaders): number | undefined {
  const raw = header(headers, 'x-amz-decoded-content-length') ?? header(headers, 'content-length');
  if (raw === undefined) return undefined;
  const size = Number(raw);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new S3Error('InvalidArgument', 'Invalid Content-Length.');
  }
  return size;
}

/** 物件上傳必須事先知道長度（與 S3 相同）；順便在讀 body 前擋掉超過上限的請求。 */
export function requireBodySize(headers: IncomingHttpHeaders, maxSize: number): number {
  const size = declaredBodySize(headers);
  if (size === undefined) throw new S3Error('MissingContentLength');
  if (size > maxSize) throw new S3Error('EntityTooLarge');
  return size;
}

export function readContentMd5(headers: IncomingHttpHeaders): string | undefined {
  const value = header(headers, 'content-md5');
  if (value === undefined) return undefined;
  if (Buffer.from(value, 'base64').length !== 16) throw new S3Error('InvalidDigest');
  return value;
}

export function readConditions(headers: IncomingHttpHeaders, prefix = ''): Conditions {
  return {
    ifMatch: header(headers, `${prefix}if-match`),
    ifNoneMatch: header(headers, `${prefix}if-none-match`),
    ifModifiedSince: header(headers, `${prefix}if-modified-since`),
    ifUnmodifiedSince: header(headers, `${prefix}if-unmodified-since`),
  };
}

/** 整數查詢參數；不是整數或超出範圍回 `InvalidArgument`。 */
export function readIntParam(
  value: string | undefined,
  name: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new S3Error('InvalidArgument', `${name} must be an integer between ${min} and ${max}.`, {
      ArgumentName: name,
      ArgumentValue: value,
    });
  }
  return parsed;
}
