import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

import { header } from '@/http/context';
import type { Query } from '@/http/target';
import type { ObjectHeaders, StoredObject } from '@/storage/types';

import { S3Error } from './errors';

/** S3 未指定 Content-Type 時的預設值。 */
export const DEFAULT_CONTENT_TYPE = 'binary/octet-stream';

const META_PREFIX = 'x-amz-meta-';
/** S3 的使用者中繼資料上限（鍵＋值的 UTF-8 位元組總和）。 */
const MAX_METADATA_BYTES = 2 * 1024;
/** S3 的 key 上限（UTF-8 位元組）。 */
const MAX_KEY_BYTES = 1024;

export function assertKeyLength(key: string): void {
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new S3Error('KeyTooLongError', undefined, { Key: key });
  }
}

/** aws-chunked 是傳輸編碼，不屬於物件本身；存下來之前要從 Content-Encoding 拿掉。 */
function stripAwsChunked(contentEncoding: string | undefined): string | undefined {
  if (contentEncoding === undefined) return undefined;
  const rest = contentEncoding
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '' && token.toLowerCase() !== 'aws-chunked');
  return rest.length === 0 ? undefined : rest.join(',');
}

export function readObjectHeaders(headers: IncomingHttpHeaders): ObjectHeaders {
  const result: ObjectHeaders = {
    contentType: header(headers, 'content-type') ?? DEFAULT_CONTENT_TYPE,
  };
  const optional = {
    cacheControl: header(headers, 'cache-control'),
    contentDisposition: header(headers, 'content-disposition'),
    contentEncoding: stripAwsChunked(header(headers, 'content-encoding')),
    contentLanguage: header(headers, 'content-language'),
    expires: header(headers, 'expires'),
  };
  for (const [name, value] of Object.entries(optional)) {
    if (value !== undefined) result[name as keyof typeof optional] = value;
  }
  return result;
}

export function readUserMetadata(headers: IncomingHttpHeaders): Record<string, string> {
  const metadata: Record<string, string> = {};
  let bytes = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (!name.startsWith(META_PREFIX) || value === undefined) continue;
    const key = name.slice(META_PREFIX.length);
    const joined = Array.isArray(value) ? value.join(',') : value;
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(joined, 'utf8');
    metadata[key] = joined;
  }
  if (bytes > MAX_METADATA_BYTES) throw new S3Error('MetadataTooLarge');
  return metadata;
}

/** GetObject 可用 `response-*` 查詢參數覆寫回應標頭（presigned 下載常用來指定檔名）。 */
const RESPONSE_OVERRIDES = {
  'response-content-type': 'Content-Type',
  'response-content-language': 'Content-Language',
  'response-expires': 'Expires',
  'response-cache-control': 'Cache-Control',
  'response-content-disposition': 'Content-Disposition',
  'response-content-encoding': 'Content-Encoding',
} as const;

/** GetObject / HeadObject 的共用回應標頭。 */
export function objectResponseHeaders(object: StoredObject, query?: Query): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {
    'Content-Type': object.headers.contentType,
    ETag: object.etag,
    'Last-Modified': object.lastModified.toUTCString(),
    'Accept-Ranges': 'bytes',
  };
  if (object.headers.cacheControl !== undefined)
    headers['Cache-Control'] = object.headers.cacheControl;
  if (object.headers.contentDisposition !== undefined) {
    headers['Content-Disposition'] = object.headers.contentDisposition;
  }
  if (object.headers.contentEncoding !== undefined) {
    headers['Content-Encoding'] = object.headers.contentEncoding;
  }
  if (object.headers.contentLanguage !== undefined) {
    headers['Content-Language'] = object.headers.contentLanguage;
  }
  if (object.headers.expires !== undefined) headers.Expires = object.headers.expires;
  for (const [name, value] of Object.entries(object.metadata))
    headers[`${META_PREFIX}${name}`] = value;

  if (query) {
    for (const [param, name] of Object.entries(RESPONSE_OVERRIDES)) {
      const value = query.get(param);
      if (value !== undefined) headers[name] = value;
    }
  }
  return headers;
}
