/**
 * 條件式請求（RFC 7232 §6 的判斷順序，S3 的 GetObject / HeadObject / CopyObject 都照這個順序）。
 */

export interface Conditions {
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
  ifModifiedSince: string | undefined;
  ifUnmodifiedSince: string | undefined;
}

export type ConditionResult = 'proceed' | 'not-modified' | 'precondition-failed';

function stripQuotes(etag: string): string {
  return etag
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1');
}

/** 標頭值可以是 `*` 或逗號分隔的多個 ETag。 */
export function etagMatches(header: string, etag: string): boolean {
  const target = stripQuotes(etag);
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || stripQuotes(value) === target;
  });
}

/** HTTP 日期只到秒，比較前把 lastModified 截到秒。 */
function modifiedAfter(lastModified: Date, header: string): boolean | undefined {
  const since = Date.parse(header);
  if (Number.isNaN(since)) return undefined;
  return Math.floor(lastModified.getTime() / 1000) > Math.floor(since / 1000);
}

export function evaluateConditions(
  conditions: Conditions,
  object: { etag: string; lastModified: Date },
): ConditionResult {
  if (conditions.ifMatch !== undefined) {
    if (!etagMatches(conditions.ifMatch, object.etag)) return 'precondition-failed';
  } else if (conditions.ifUnmodifiedSince !== undefined) {
    if (modifiedAfter(object.lastModified, conditions.ifUnmodifiedSince) === true) {
      return 'precondition-failed';
    }
  }

  if (conditions.ifNoneMatch !== undefined) {
    if (etagMatches(conditions.ifNoneMatch, object.etag)) return 'not-modified';
  } else if (conditions.ifModifiedSince !== undefined) {
    if (modifiedAfter(object.lastModified, conditions.ifModifiedSince) === false) {
      return 'not-modified';
    }
  }
  return 'proceed';
}
