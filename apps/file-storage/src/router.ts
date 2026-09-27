import * as bucket from '@/handlers/bucket';
import * as multipart from '@/handlers/multipart';
import * as object from '@/handlers/object';
import type { RequestContext } from '@/http/context';
import type { Query } from '@/http/target';
import { S3Error } from '@/s3/errors';

export interface Route {
  /** S3 的操作名稱（與 AWS SDK 的 Command 同名），用於日誌。 */
  operation: string;
  handler: (context: RequestContext) => Promise<void>;
}

/**
 * 這些子資源代表 S3 有、但模擬器沒有實作的功能。
 * 明確回 `NotImplemented`，而不是被當成一般的 Get/PutObject 靜默處理掉。
 */
const UNSUPPORTED_SUBRESOURCES = [
  'accelerate',
  'acl',
  'analytics',
  'attributes',
  'cors',
  'encryption',
  'intelligent-tiering',
  'inventory',
  'legal-hold',
  'lifecycle',
  'logging',
  'metrics',
  'notification',
  'object-lock',
  'ownershipControls',
  'policy',
  'policyStatus',
  'publicAccessBlock',
  'replication',
  'requestPayment',
  'restore',
  'retention',
  'select',
  'tagging',
  'torrent',
  'versionId',
  'versioning',
  'versions',
  'website',
] as const;

function notImplemented(query: Query): never {
  const found = UNSUPPORTED_SUBRESOURCES.find((name) => query.has(name));
  throw new S3Error(
    'NotImplemented',
    found === undefined ? undefined : `The '${found}' subresource is not supported.`,
  );
}

function methodNotAllowed(method: string): never {
  throw new S3Error('MethodNotAllowed', undefined, { Method: method });
}

function route(operation: string, handler: Route['handler']): Route {
  return { operation, handler };
}

function serviceRoute(method: string): Route {
  if (method === 'GET') return route('ListBuckets', bucket.listBuckets);
  return methodNotAllowed(method);
}

function bucketRoute(method: string, query: Query): Route {
  switch (method) {
    case 'GET':
      if (query.has('location')) return route('GetBucketLocation', bucket.getBucketLocation);
      if (query.has('uploads')) return notImplemented(query);
      if (query.get('list-type') === '2') return route('ListObjectsV2', bucket.listObjectsV2);
      return route('ListObjects', bucket.listObjectsV1);
    case 'HEAD':
      return route('HeadBucket', bucket.headBucket);
    case 'PUT':
      return route('CreateBucket', bucket.createBucket);
    case 'DELETE':
      return route('DeleteBucket', bucket.deleteBucket);
    case 'POST':
      if (query.has('delete')) return route('DeleteObjects', bucket.deleteObjects);
      return notImplemented(query);
    default:
      return methodNotAllowed(method);
  }
}

function objectRoute(method: string, query: Query, hasCopySource: boolean): Route {
  switch (method) {
    case 'GET':
      if (query.has('uploadId')) return notImplemented(query);
      return route('GetObject', object.getObject);
    case 'HEAD':
      return route('HeadObject', object.headObject);
    case 'PUT':
      if (query.has('uploadId') && query.has('partNumber')) {
        return route('UploadPart', multipart.uploadPart);
      }
      if (hasCopySource) return route('CopyObject', object.copyObject);
      return route('PutObject', object.putObject);
    case 'DELETE':
      if (query.has('uploadId'))
        return route('AbortMultipartUpload', multipart.abortMultipartUpload);
      return route('DeleteObject', object.deleteObject);
    case 'POST':
      if (query.has('uploads'))
        return route('CreateMultipartUpload', multipart.createMultipartUpload);
      if (query.has('uploadId')) {
        return route('CompleteMultipartUpload', multipart.completeMultipartUpload);
      }
      return notImplemented(query);
    default:
      return methodNotAllowed(method);
  }
}

/** 依 method、路徑層級與子資源決定 S3 操作（對照 S3 REST API 的路由方式）。 */
export function resolveRoute(
  method: string,
  target: { bucket: string | undefined; key: string | undefined; query: Query },
  hasCopySource: boolean,
): Route {
  if (UNSUPPORTED_SUBRESOURCES.some((name) => target.query.has(name))) notImplemented(target.query);
  if (target.bucket === undefined) return serviceRoute(method);
  if (target.key === undefined) return bucketRoute(method, target.query);
  return objectRoute(method, target.query, hasCopySource);
}
