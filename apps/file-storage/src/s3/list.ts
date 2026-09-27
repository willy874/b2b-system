/**
 * ListObjects（V1 / V2）共用的分頁與 delimiter 折疊。純函式，輸入必須已依 UTF-8 位元組排序。
 * 規則：https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
 */

export interface ListOptions {
  prefix: string;
  delimiter: string | undefined;
  /** 只回傳嚴格大於它的 key（V1 的 marker、V2 的 start-after / continuation token 都轉成它）。 */
  after: string | undefined;
  maxKeys: number;
}

export interface ListPage<T> {
  contents: T[];
  commonPrefixes: string[];
  isTruncated: boolean;
  /** 這一頁最後一個項目（key 或 common prefix），給下一頁接續用。 */
  lastItem: string | undefined;
}

export function listPage<T extends { key: string }>(
  sorted: readonly T[],
  options: ListOptions,
): ListPage<T> {
  const contents: T[] = [];
  const commonPrefixes: string[] = [];
  let lastItem: string | undefined;
  let isTruncated = false;

  for (const object of sorted) {
    const { key } = object;
    if (!key.startsWith(options.prefix)) continue;
    if (options.after !== undefined && !isAfterUtf8(key, options.after)) continue;

    const rest = key.slice(options.prefix.length);
    const delimiterAt =
      options.delimiter === undefined || options.delimiter === ''
        ? -1
        : rest.indexOf(options.delimiter);
    const item =
      delimiterAt < 0
        ? key
        : options.prefix + rest.slice(0, delimiterAt + (options.delimiter?.length ?? 0));
    const isCommonPrefix = delimiterAt >= 0;

    // 同一個 common prefix 底下的 key 只算一次；上一頁結束在這個 prefix 時整組跳過
    if (isCommonPrefix && (item === lastItem || item === options.after)) continue;

    if (contents.length + commonPrefixes.length >= options.maxKeys) {
      isTruncated = true;
      break;
    }
    if (isCommonPrefix) commonPrefixes.push(item);
    else contents.push(object);
    lastItem = item;
  }

  return { contents, commonPrefixes, isTruncated, lastItem };
}

/** `after` 的比較要用 UTF-8 位元組序，與排序一致（JS 字串比較是 UTF-16，遇到補充平面字元會不同）。 */
function isAfterUtf8(key: string, after: string): boolean {
  return Buffer.compare(Buffer.from(key, 'utf8'), Buffer.from(after, 'utf8')) > 0;
}

/** V2 的 continuation token 對客戶端是不透明字串；內容就是上一頁最後一個項目。 */
export function encodeContinuationToken(lastItem: string): string {
  return Buffer.from(lastItem, 'utf8').toString('base64url');
}

export function decodeContinuationToken(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8');
}
