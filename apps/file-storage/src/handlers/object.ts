import { pipeline } from 'node:stream/promises';

import {
  header,
  type RequestContext,
  requireBucketName,
  requireKey,
  sendEmpty,
  sendXml,
} from '@/http/context';
import { evaluateConditions } from '@/s3/conditions';
import { S3Error } from '@/s3/errors';
import {
  assertKeyLength,
  objectResponseHeaders,
  readObjectHeaders,
  readUserMetadata,
} from '@/s3/object-headers';
import { text, xmlDocument } from '@/s3/xml';
import type { ByteRange } from '@/storage/disk-store';
import type { StoredObject } from '@/storage/types';

import { readConditions, readContentMd5, requireBodySize } from './request-fields';

/** `PUT /<bucket>/<key>` */
export async function putObject(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const key = requireKey(context);
  assertKeyLength(key);
  const { headers } = context;
  const ifNoneMatch = header(headers, 'if-none-match');
  if (ifNoneMatch !== undefined && ifNoneMatch !== '*') {
    throw new S3Error('NotImplemented', 'If-None-Match only supports "*" on PutObject.');
  }

  const object = await context.store.putObject(bucket, key, context.body(), {
    headers: readObjectHeaders(headers),
    metadata: readUserMetadata(headers),
    expectedSize: requireBodySize(headers, context.config.maxObjectSize),
    contentMd5: readContentMd5(headers),
    maxSize: context.config.maxObjectSize,
    ifNoneMatch,
    ifMatch: header(headers, 'if-match'),
  });
  sendEmpty(context, 200, { ETag: object.etag });
}

/**
 * 解析單一區段的 `Range: bytes=…`。多段或格式不符時回 undefined（S3 會忽略並回整個物件）；
 * 起點超過物件大小回 `InvalidRange`。
 */
export function parseRange(value: string | undefined, size: number): ByteRange | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;
  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return undefined;

  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) throw new S3Error('InvalidRange', undefined, { RangeRequested: value });
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) {
    throw new S3Error('InvalidRange', undefined, {
      RangeRequested: value,
      ActualObjectSize: String(size),
    });
  }
  return { start, end };
}

/** 條件不成立時直接回應並回傳 false。 */
function checkReadConditions(context: RequestContext, object: StoredObject): boolean {
  const result = evaluateConditions(readConditions(context.headers), object);
  if (result === 'precondition-failed') throw new S3Error('PreconditionFailed');
  if (result === 'not-modified') {
    sendEmpty(context, 304, {
      ETag: object.etag,
      'Last-Modified': object.lastModified.toUTCString(),
    });
    return false;
  }
  return true;
}

/** `GET /<bucket>/<key>` */
export async function getObject(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const object = context.store.getObject(bucket, requireKey(context));
  if (!checkReadConditions(context, object)) return;

  const range = parseRange(header(context.headers, 'range'), object.size);
  const headers = objectResponseHeaders(object, context.query);
  // 空物件沒有任何位元組可讀；檔案串流對 0 長度 + range 會出錯
  const stream =
    object.size === 0 ? undefined : await context.store.openObject(bucket, object, range);

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${object.size}`;
    headers['Content-Length'] = range.end - range.start + 1;
    context.res.writeHead(206, headers);
  } else {
    headers['Content-Length'] = object.size;
    context.res.writeHead(200, headers);
  }
  if (!stream) {
    context.res.end();
    return;
  }
  try {
    await pipeline(stream, context.res);
  } catch (error) {
    // 客戶端讀到一半斷線（取消下載、只要前幾個位元組）是正常情況，不當成伺服器錯誤
    if (context.res.destroyed && !context.res.writableFinished) return;
    throw error;
  }
}

/** `HEAD /<bucket>/<key>` */
export async function headObject(context: RequestContext): Promise<void> {
  const object = context.store.getObject(requireBucketName(context), requireKey(context));
  if (!checkReadConditions(context, object)) return;
  const headers = objectResponseHeaders(object, context.query);
  headers['Content-Length'] = object.size;
  context.res.writeHead(200, headers);
  context.res.end();
}

/** `DELETE /<bucket>/<key>`：物件不存在也回 204（與 S3 相同）。 */
export async function deleteObject(context: RequestContext): Promise<void> {
  await context.store.deleteObject(requireBucketName(context), requireKey(context));
  sendEmpty(context, 204);
}

/** `x-amz-copy-source: /<bucket>/<key>`（可省略開頭的 `/`，key 經過 URL 編碼）。 */
function parseCopySource(value: string): { bucket: string; key: string } {
  const [path = ''] = value.split('?', 1);
  if (value.includes('?versionId=')) {
    throw new S3Error('NotImplemented', 'Versioning is not supported.');
  }
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  const separator = trimmed.indexOf('/');
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new S3Error(
      'InvalidArgument',
      'Copy Source must mention the source bucket and key: sourcebucket/sourcekey',
      {
        ArgumentName: 'x-amz-copy-source',
        ArgumentValue: value,
      },
    );
  }
  try {
    return {
      bucket: decodeURIComponent(trimmed.slice(0, separator)),
      key: decodeURIComponent(trimmed.slice(separator + 1)),
    };
  } catch {
    throw new S3Error('InvalidArgument', 'Invalid copy source encoding.');
  }
}

/** `PUT /<bucket>/<key>` ＋ `x-amz-copy-source` */
export async function copyObject(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const key = requireKey(context);
  assertKeyLength(key);
  const { headers } = context;
  const source = parseCopySource(header(headers, 'x-amz-copy-source') ?? '');
  const original = context.store.getObject(source.bucket, source.key);

  const result = evaluateConditions(readConditions(headers, 'x-amz-copy-source-'), original);
  if (result !== 'proceed') throw new S3Error('PreconditionFailed');

  const directive = header(headers, 'x-amz-metadata-directive') ?? 'COPY';
  if (directive !== 'COPY' && directive !== 'REPLACE') {
    throw new S3Error('InvalidArgument', 'Unknown metadata directive.', {
      ArgumentName: 'x-amz-metadata-directive',
      ArgumentValue: directive,
    });
  }
  if (directive === 'COPY' && source.bucket === bucket && source.key === key) {
    throw new S3Error(
      'InvalidRequest',
      "This copy request is illegal because it is trying to copy an object to itself without changing the object's metadata, storage class, website redirect location or encryption attributes.",
    );
  }

  const object = await context.store.copyObject(
    source,
    { bucket, key },
    directive === 'REPLACE'
      ? { headers: readObjectHeaders(headers), metadata: readUserMetadata(headers) }
      : undefined,
  );
  sendXml(
    context,
    200,
    xmlDocument('CopyObjectResult', [
      text('LastModified', object.lastModified.toISOString()),
      text('ETag', object.etag),
    ]),
  );
}
