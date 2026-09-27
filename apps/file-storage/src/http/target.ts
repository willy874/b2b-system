import { S3Error } from '@/s3/errors';

/**
 * 查詢參數。保留原始順序與重複值，因為 SigV4 的 canonical query 要用到全部參數。
 * S3 的子資源（`?uploads`、`?delete`）沒有 `=`，值視為空字串。
 */
export class Query {
  constructor(readonly entries: readonly (readonly [string, string])[]) {}

  get(name: string): string | undefined {
    return this.entries.find(([key]) => key === name)?.[1];
  }

  has(name: string): boolean {
    return this.entries.some(([key]) => key === name);
  }
}

/**
 * 一個請求要操作的對象。只支援 path-style（`/<bucket>/<key>`）；
 * 客戶端要設定 `forcePathStyle: true`（docs/architecture/03-file-storage.md §3）。
 */
export interface RequestTarget {
  /** 客戶端送來、尚未解碼的路徑，SigV4 以它為準計算 canonical URI。 */
  rawPath: string;
  bucket: string | undefined;
  key: string | undefined;
  query: Query;
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new S3Error('InvalidURI');
  }
}

export function parseQuery(rawQuery: string): Query {
  const entries = rawQuery
    .split('&')
    .filter((part) => part !== '')
    .map((part): readonly [string, string] => {
      const separator = part.indexOf('=');
      if (separator < 0) return [decodeComponent(part), ''];
      return [
        decodeComponent(part.slice(0, separator)),
        decodeComponent(part.slice(separator + 1)),
      ];
    });
  return new Query(entries);
}

export function parseTarget(url: string): RequestTarget {
  const querySeparator = url.indexOf('?');
  const rawPath = querySeparator < 0 ? url : url.slice(0, querySeparator);
  const rawQuery = querySeparator < 0 ? '' : url.slice(querySeparator + 1);
  if (!rawPath.startsWith('/')) throw new S3Error('InvalidURI');

  const path = rawPath.slice(1);
  const keySeparator = path.indexOf('/');
  const rawBucket = keySeparator < 0 ? path : path.slice(0, keySeparator);
  const rawKey = keySeparator < 0 ? '' : path.slice(keySeparator + 1);

  return {
    rawPath,
    bucket: rawBucket === '' ? undefined : decodeComponent(rawBucket),
    key: rawKey === '' ? undefined : decodeComponent(rawKey),
    query: parseQuery(rawQuery),
  };
}
