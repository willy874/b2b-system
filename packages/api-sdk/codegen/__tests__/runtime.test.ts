import { describe, expect, it } from 'vitest';

import { ApiError, buildUrl, request, serializeQuery } from '../runtime';
import type { OperationDefinition } from '../runtime';

describe('buildUrl', () => {
  it('path 參數會被 encode', () => {
    expect(buildUrl('/files/{name}', { name: 'a b/c' })).toBe('/files/a%20b%2Fc');
  });

  it('缺少 path 參數時丟錯，不送出 `/users/undefined`', () => {
    expect(() => buildUrl('/users/{id}', {})).toThrow(/id/);
  });
});

describe('serializeQuery', () => {
  it.each([
    ['略過 undefined 與 null', { a: undefined, b: null, c: 0 }, '?c=0'],
    ['陣列展開成重複的 key', { tag: ['a', 'b'] }, '?tag=a&tag=b'],
    [
      '物件用 deepObject',
      { filter: { name: 'x', age: 3 } },
      '?filter%5Bname%5D=x&filter%5Bage%5D=3',
    ],
    [
      'Date 轉 ISO 字串',
      { at: new Date('2026-01-01T00:00:00Z') },
      '?at=2026-01-01T00%3A00%3A00.000Z',
    ],
    ['空物件不輸出 ?', {}, ''],
  ])('%s', (_, query, expected) => {
    expect(serializeQuery(query)).toBe(expected);
  });
});

describe('request（回應解析）', () => {
  const operation: OperationDefinition = {
    id: 'op',
    method: 'GET',
    path: '/x',
    responseTypes: { 200: 'json' },
    schemas: {},
  };

  it('非 JSON 的錯誤頁（例：proxy 502 HTML）保留原文放進 ApiError', async () => {
    const call = request(
      operation,
      {},
      { fetch: async () => new Response('<html>bad gateway</html>', { status: 502 }) },
    );
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({ status: 502, data: '<html>bad gateway</html>' });
  });

  it('空 body 的成功回應 data 是 undefined', async () => {
    const result = await request(
      operation,
      {},
      { fetch: async () => new Response('', { status: 200 }) },
    );
    expect(result).toMatchObject({ status: 200, data: undefined });
  });

  it('options 的 signal 會傳給 fetch', async () => {
    const controller = new AbortController();
    let received: AbortSignal | null | undefined;
    await request(
      operation,
      {},
      {
        signal: controller.signal,
        fetch: async (_, init) => {
          received = init?.signal;
          return new Response('{}', { status: 200 });
        },
      },
    );
    expect(received).toBe(controller.signal);
  });
});
