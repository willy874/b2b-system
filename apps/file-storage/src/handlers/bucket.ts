import { createHash } from 'node:crypto';

import { readBodyBuffer } from '@/http/body';
import { type RequestContext, requireBucketName, sendEmpty, sendXml } from '@/http/context';
import { isValidBucketName } from '@/s3/bucket-name';
import { S3Error } from '@/s3/errors';
import {
  decodeContinuationToken,
  encodeContinuationToken,
  type ListOptions,
  listPage,
} from '@/s3/list';
import { element, readElements, readText, text, xmlDocument } from '@/s3/xml';

import { readIntParam } from './request-fields';

const MAX_LIST_KEYS = 1000;
const MAX_DELETE_KEYS = 1000;
/** `<Delete>` 最多 1000 個 key、每個 key 最長 1024 位元組，再加上標籤的餘裕。 */
const MAX_DELETE_BODY_BYTES = 2 * 1024 * 1024;
/** CreateBucket 的 body 只可能是 `<CreateBucketConfiguration>`。 */
const MAX_CREATE_BUCKET_BODY_BYTES = 64 * 1024;

/** `<Owner>` / `<Initiator>` 的內容：模擬器只有一個帳號。 */
function principal(context: RequestContext): string[] {
  return [
    text('ID', createHash('sha256').update(context.config.credentials.accessKeyId).digest('hex')),
    text('DisplayName', 'file-storage'),
  ];
}

function owner(context: RequestContext): string {
  return element('Owner', principal(context));
}

/** `GET /` */
export async function listBuckets(context: RequestContext): Promise<void> {
  const buckets = context.store.listBuckets();
  sendXml(
    context,
    200,
    xmlDocument('ListAllMyBucketsResult', [
      owner(context),
      element(
        'Buckets',
        buckets.map((bucket) =>
          element('Bucket', [
            text('Name', bucket.name),
            text('CreationDate', bucket.createdAt.toISOString()),
          ]),
        ),
      ),
    ]),
  );
}

/** `PUT /<bucket>` */
export async function createBucket(context: RequestContext): Promise<void> {
  const name = requireBucketName(context);
  if (!isValidBucketName(name))
    throw new S3Error('InvalidBucketName', undefined, { BucketName: name });
  // body 可能帶 <CreateBucketConfiguration><LocationConstraint>；模擬器只有一個 region，讀掉即可
  await readBodyBuffer(context.body(), MAX_CREATE_BUCKET_BODY_BYTES);
  await context.store.createBucket(name);
  sendEmpty(context, 200, { Location: `/${name}` });
}

/** `DELETE /<bucket>` */
export async function deleteBucket(context: RequestContext): Promise<void> {
  await context.store.deleteBucket(requireBucketName(context));
  sendEmpty(context, 204);
}

/** `HEAD /<bucket>` */
export async function headBucket(context: RequestContext): Promise<void> {
  context.store.getBucket(requireBucketName(context));
  sendEmpty(context, 200, { 'x-amz-bucket-region': context.config.region });
}

/** `GET /<bucket>?location` */
export async function getBucketLocation(context: RequestContext): Promise<void> {
  context.store.getBucket(requireBucketName(context));
  // us-east-1 在 S3 回空的 LocationConstraint
  const region = context.config.region === 'us-east-1' ? '' : context.config.region;
  sendXml(
    context,
    200,
    `<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${region}</LocationConstraint>`,
  );
}

function readListOptions(context: RequestContext, after: string | undefined): ListOptions {
  const { query } = context;
  const maxKeys = readIntParam(query.get('max-keys'), 'max-keys', {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: MAX_LIST_KEYS,
  });
  const encodingType = query.get('encoding-type');
  if (encodingType !== undefined && encodingType !== 'url') {
    throw new S3Error('InvalidArgument', 'Invalid Encoding Method specified in Request', {
      ArgumentName: 'encoding-type',
      ArgumentValue: encodingType,
    });
  }
  return {
    prefix: query.get('prefix') ?? '',
    delimiter: query.get('delimiter') || undefined,
    after,
    maxKeys: Math.min(maxKeys, MAX_LIST_KEYS),
  };
}

/** `encoding-type=url` 時，回應中的 key 類欄位要 URL 編碼（客戶端會再解碼）。 */
function encoder(context: RequestContext): (value: string) => string {
  return context.query.get('encoding-type') === 'url'
    ? (value) => encodeURIComponent(value).replace(/%2F/g, '/')
    : (value) => value;
}

function contentsXml(
  objects: readonly { key: string; lastModified: Date; etag: string; size: number }[],
  encode: (value: string) => string,
  withOwner: string | undefined,
): string[] {
  return objects.map((object) =>
    element('Contents', [
      text('Key', encode(object.key)),
      text('LastModified', object.lastModified.toISOString()),
      text('ETag', object.etag),
      text('Size', object.size),
      withOwner,
      text('StorageClass', 'STANDARD'),
    ]),
  );
}

/** `GET /<bucket>?list-type=2` */
export async function listObjectsV2(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const { query } = context;
  const continuationToken = query.get('continuation-token');
  const startAfter = query.get('start-after');
  const after =
    continuationToken !== undefined ? decodeContinuationToken(continuationToken) : startAfter;
  const options = readListOptions(context, after || undefined);
  const page = listPage(context.store.listObjects(bucket), options);
  const encode = encoder(context);
  const withOwner = query.get('fetch-owner') === 'true' ? owner(context) : undefined;

  sendXml(
    context,
    200,
    xmlDocument('ListBucketResult', [
      text('Name', bucket),
      text('Prefix', encode(options.prefix)),
      options.delimiter !== undefined && text('Delimiter', encode(options.delimiter)),
      text('MaxKeys', options.maxKeys),
      query.has('encoding-type') && text('EncodingType', 'url'),
      text('KeyCount', page.contents.length + page.commonPrefixes.length),
      text('IsTruncated', page.isTruncated),
      continuationToken !== undefined && text('ContinuationToken', continuationToken),
      page.isTruncated &&
        page.lastItem !== undefined &&
        text('NextContinuationToken', encodeContinuationToken(page.lastItem)),
      startAfter !== undefined && text('StartAfter', encode(startAfter)),
      ...contentsXml(page.contents, encode, withOwner),
      ...page.commonPrefixes.map((prefix) =>
        element('CommonPrefixes', [text('Prefix', encode(prefix))]),
      ),
    ]),
  );
}

/** `GET /<bucket>`（ListObjects V1） */
export async function listObjectsV1(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const marker = context.query.get('marker');
  const options = readListOptions(context, marker || undefined);
  const page = listPage(context.store.listObjects(bucket), options);
  const encode = encoder(context);

  sendXml(
    context,
    200,
    xmlDocument('ListBucketResult', [
      text('Name', bucket),
      text('Prefix', encode(options.prefix)),
      text('Marker', encode(marker ?? '')),
      // V1 只在有 delimiter 時回 NextMarker；沒有時客戶端用最後一個 key 接續
      page.isTruncated &&
        options.delimiter !== undefined &&
        page.lastItem !== undefined &&
        text('NextMarker', encode(page.lastItem)),
      text('MaxKeys', options.maxKeys),
      options.delimiter !== undefined && text('Delimiter', encode(options.delimiter)),
      context.query.has('encoding-type') && text('EncodingType', 'url'),
      text('IsTruncated', page.isTruncated),
      ...contentsXml(page.contents, encode, owner(context)),
      ...page.commonPrefixes.map((prefix) =>
        element('CommonPrefixes', [text('Prefix', encode(prefix))]),
      ),
    ]),
  );
}

/** `POST /<bucket>?delete`（DeleteObjects） */
export async function deleteObjects(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  context.store.getBucket(bucket);
  const xml = (await readBodyBuffer(context.body(), MAX_DELETE_BODY_BYTES)).toString('utf8');
  const [deleteElement] = readElements(xml, 'Delete');
  if (deleteElement === undefined) throw new S3Error('MalformedXML');

  const keys = readElements(deleteElement, 'Object').map((object) => {
    const key = readText(object, 'Key');
    if (key === undefined || key === '') throw new S3Error('MalformedXML');
    return key;
  });
  if (keys.length === 0 || keys.length > MAX_DELETE_KEYS) throw new S3Error('MalformedXML');
  const isQuiet = readText(deleteElement, 'Quiet') === 'true';

  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        await context.store.deleteObject(bucket, key);
        return { key, error: undefined };
      } catch (error) {
        const s3Error = error instanceof S3Error ? error : new S3Error('InternalError');
        return { key, error: s3Error };
      }
    }),
  );

  sendXml(
    context,
    200,
    xmlDocument(
      'DeleteResult',
      results.map(({ key, error }) =>
        error === undefined
          ? !isQuiet && element('Deleted', [text('Key', key)])
          : element('Error', [
              text('Key', key),
              text('Code', error.code),
              text('Message', error.message),
            ]),
      ),
    ),
  );
}

const MAX_LIST_UPLOADS = 1000;

/**
 * `GET /<bucket>?uploads`（ListMultipartUploads）。支援 `prefix`、`max-uploads`、
 * `key-marker` / `upload-id-marker` 分頁與 `encoding-type=url`；不支援 `delimiter`。
 */
export async function listMultipartUploads(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const { query } = context;
  if (query.get('delimiter')) {
    throw new S3Error('NotImplemented', 'ListMultipartUploads does not support delimiter.');
  }
  const prefix = query.get('prefix') ?? '';
  const keyMarker = query.get('key-marker') || undefined;
  // 規格：沒有 key-marker 時忽略 upload-id-marker
  const uploadIdMarker = keyMarker ? query.get('upload-id-marker') || undefined : undefined;
  const maxUploads = Math.min(
    readIntParam(query.get('max-uploads'), 'max-uploads', {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      fallback: MAX_LIST_UPLOADS,
    }),
    MAX_LIST_UPLOADS,
  );
  const encode = encoder(context);

  const all = context.store.listUploads(bucket).filter((upload) => upload.key.startsWith(prefix));
  let start = 0;
  if (keyMarker !== undefined) {
    const markerIndex =
      uploadIdMarker === undefined
        ? -1
        : all.findIndex((upload) => upload.key === keyMarker && upload.uploadId === uploadIdMarker);
    // 有 upload-id-marker：接在那一筆之後；沒有（或找不到）：從 key 大於 key-marker 的開始
    start =
      markerIndex >= 0
        ? markerIndex + 1
        : all.findIndex(
            (upload) => Buffer.compare(Buffer.from(upload.key), Buffer.from(keyMarker)) > 0,
          );
    if (start < 0) start = all.length;
  }
  const page = all.slice(start, start + maxUploads);
  const isTruncated = start + page.length < all.length;
  const last = page.at(-1);
  const initiator = principal(context);

  sendXml(
    context,
    200,
    xmlDocument('ListMultipartUploadsResult', [
      text('Bucket', bucket),
      text('KeyMarker', encode(keyMarker ?? '')),
      text('UploadIdMarker', uploadIdMarker ?? ''),
      isTruncated && last !== undefined && text('NextKeyMarker', encode(last.key)),
      isTruncated && last !== undefined && text('NextUploadIdMarker', last.uploadId),
      text('Prefix', encode(prefix)),
      text('MaxUploads', maxUploads),
      query.has('encoding-type') && text('EncodingType', 'url'),
      text('IsTruncated', isTruncated),
      ...page.map((upload) =>
        element('Upload', [
          text('Key', encode(upload.key)),
          text('UploadId', upload.uploadId),
          element('Initiator', initiator),
          element('Owner', initiator),
          text('StorageClass', 'STANDARD'),
          text('Initiated', upload.initiatedAt.toISOString()),
        ]),
      ),
    ]),
  );
}
