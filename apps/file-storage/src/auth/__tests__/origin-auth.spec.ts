import { describe, expect, it } from 'vitest';

import { isOriginAuthorized } from '../origin-auth';

const SECRET = 'cdn-origin-secret-for-tests-0123456789abcdef';

/** 請求的形狀（`null` 的 key 代表不是一個物件：列表、bucket 操作）。 */
const request = (
  method: string,
  value: string | string[] | undefined,
  key: string | null = 'a/b',
) => ({
  method,
  key: key ?? undefined,
  headers: value === undefined ? {} : { 'x-origin-auth': value },
});

describe('isOriginAuthorized（CDN 的回源憑證，docs/architecture/03-file-storage.md §3.3）', () => {
  it('GET／HEAD 一個物件、值相符 → 通過', () => {
    expect(isOriginAuthorized(request('GET', SECRET), SECRET)).toBe(true);
    expect(isOriginAuthorized(request('HEAD', SECRET), SECRET)).toBe(true);
  });

  it.each([
    ['沒設定回源憑證', request('GET', SECRET), undefined],
    ['值不同', request('GET', `${SECRET}x`), SECRET],
    ['沒帶標頭', request('GET', undefined), SECRET],
    ['重複的標頭', request('GET', [SECRET, SECRET]), SECRET],
    ['寫入', request('PUT', SECRET), SECRET],
    ['刪除', request('DELETE', SECRET), SECRET],
    ['不是物件（列表、bucket）', request('GET', SECRET, null), SECRET],
    [
      '改寫回應標頭（response-content-type）',
      { ...request('GET', SECRET), queryNames: ['response-content-type'] },
      SECRET,
    ],
  ])('%s → 不通過（照舊驗 SigV4）', (_name, input, secret) => {
    expect(isOriginAuthorized(input, secret)).toBe(false);
  });
});
