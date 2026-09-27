import { readBodyBuffer } from '@/http/body';
import {
  header,
  type RequestContext,
  requireBucketName,
  requireKey,
  sendEmpty,
  sendXml,
} from '@/http/context';
import { S3Error } from '@/s3/errors';
import { assertKeyLength, readObjectHeaders, readUserMetadata } from '@/s3/object-headers';
import { readElements, readText, text, xmlDocument } from '@/s3/xml';
import type { CompletedPart } from '@/storage/disk-store';

import { readContentMd5, readIntParam, requireBodySize } from './request-fields';

const MAX_PART_NUMBER = 10_000;
/** S3 單一 part 的上限。 */
const MAX_PART_SIZE = 5 * 1024 ** 3;
/** 10000 個 `<Part>`，每個含 ETag 與 checksum 欄位。 */
const MAX_COMPLETE_BODY_BYTES = 4 * 1024 * 1024;

function requireUploadId(context: RequestContext): string {
  const uploadId = context.query.get('uploadId');
  if (!uploadId) throw new S3Error('NoSuchUpload');
  return uploadId;
}

/** `POST /<bucket>/<key>?uploads` */
export async function createMultipartUpload(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const key = requireKey(context);
  assertKeyLength(key);
  const upload = await context.store.createMultipartUpload(
    bucket,
    key,
    readObjectHeaders(context.headers),
    readUserMetadata(context.headers),
  );
  sendXml(
    context,
    200,
    xmlDocument('InitiateMultipartUploadResult', [
      text('Bucket', bucket),
      text('Key', key),
      text('UploadId', upload.uploadId),
    ]),
  );
}

/** `PUT /<bucket>/<key>?partNumber=N&uploadId=…` */
export async function uploadPart(context: RequestContext): Promise<void> {
  if (header(context.headers, 'x-amz-copy-source') !== undefined) {
    throw new S3Error('NotImplemented', 'UploadPartCopy is not supported.');
  }
  const upload = context.store.getUpload(
    requireUploadId(context),
    requireBucketName(context),
    requireKey(context),
  );
  const partNumber = readIntParam(context.query.get('partNumber'), 'partNumber', {
    min: 1,
    max: MAX_PART_NUMBER,
    fallback: Number.NaN,
  });
  const maxSize = Math.min(MAX_PART_SIZE, context.config.maxObjectSize);
  const part = await context.store.uploadPart(upload, partNumber, context.body(), {
    expectedSize: requireBodySize(context.headers, maxSize),
    contentMd5: readContentMd5(context.headers),
    maxSize,
  });
  sendEmpty(context, 200, { ETag: part.etag });
}

function parseCompletedParts(xml: string): CompletedPart[] {
  const [root] = readElements(xml, 'CompleteMultipartUpload');
  if (root === undefined) throw new S3Error('MalformedXML');
  return readElements(root, 'Part').map((part) => {
    const partNumber = Number(readText(part, 'PartNumber'));
    const etag = readText(part, 'ETag');
    if (!Number.isInteger(partNumber) || etag === undefined) throw new S3Error('MalformedXML');
    return { partNumber, etag };
  });
}

/** `POST /<bucket>/<key>?uploadId=…` */
export async function completeMultipartUpload(context: RequestContext): Promise<void> {
  const bucket = requireBucketName(context);
  const key = requireKey(context);
  const upload = context.store.getUpload(requireUploadId(context), bucket, key);
  const xml = (await readBodyBuffer(context.body(), MAX_COMPLETE_BODY_BYTES)).toString('utf8');
  const object = await context.store.completeMultipartUpload(
    upload,
    parseCompletedParts(xml),
    context.config.minPartSize,
  );

  const host = header(context.headers, 'host') ?? 'localhost';
  const location = `http://${host}/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  sendXml(
    context,
    200,
    xmlDocument('CompleteMultipartUploadResult', [
      text('Location', location),
      text('Bucket', bucket),
      text('Key', key),
      text('ETag', object.etag),
    ]),
  );
}

/** `DELETE /<bucket>/<key>?uploadId=…` */
export async function abortMultipartUpload(context: RequestContext): Promise<void> {
  const upload = context.store.getUpload(
    requireUploadId(context),
    requireBucketName(context),
    requireKey(context),
  );
  await context.store.abortMultipartUpload(upload);
  sendEmpty(context, 204);
}
