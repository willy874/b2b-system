import {
  decodeContinuationToken,
  encodeContinuationToken,
  listPage,
  lowerBoundUtf8,
} from '@/s3/list';

const objects = ['a', 'b/1', 'b/2', 'b/c/3', 'c', 'd/4'].map((key) => ({ key }));

function keysOf(page: ReturnType<typeof listPage<{ key: string }>>) {
  return {
    contents: page.contents.map((object) => object.key),
    prefixes: page.commonPrefixes,
    isTruncated: page.isTruncated,
    lastItem: page.lastItem,
  };
}

describe('listPage（ListObjects 的分頁與 delimiter 折疊）', () => {
  it.each([
    {
      name: '沒有 delimiter：全部列出',
      options: { prefix: '', delimiter: undefined, after: undefined, maxKeys: 1000 },
      expected: {
        contents: ['a', 'b/1', 'b/2', 'b/c/3', 'c', 'd/4'],
        prefixes: [],
        isTruncated: false,
      },
    },
    {
      name: 'delimiter 折疊成 common prefix',
      options: { prefix: '', delimiter: '/', after: undefined, maxKeys: 1000 },
      expected: { contents: ['a', 'c'], prefixes: ['b/', 'd/'], isTruncated: false },
    },
    {
      name: 'prefix 之後才找 delimiter',
      options: { prefix: 'b/', delimiter: '/', after: undefined, maxKeys: 1000 },
      expected: { contents: ['b/1', 'b/2'], prefixes: ['b/c/'], isTruncated: false },
    },
    {
      name: 'common prefix 與 key 一起計入 maxKeys',
      options: { prefix: '', delimiter: '/', after: undefined, maxKeys: 2 },
      expected: { contents: ['a'], prefixes: ['b/'], isTruncated: true },
    },
    {
      name: 'after 為 common prefix 時跳過整組',
      options: { prefix: '', delimiter: '/', after: 'b/', maxKeys: 1000 },
      expected: { contents: ['c'], prefixes: ['d/'], isTruncated: false },
    },
    {
      name: 'after 為 key 時只回嚴格大於它的',
      options: { prefix: '', delimiter: undefined, after: 'b/2', maxKeys: 1000 },
      expected: { contents: ['b/c/3', 'c', 'd/4'], prefixes: [], isTruncated: false },
    },
    {
      name: '剛好滿頁、後面沒有新項目時不算 truncated',
      options: { prefix: '', delimiter: '/', after: 'b/', maxKeys: 2 },
      expected: { contents: ['c'], prefixes: ['d/'], isTruncated: false },
    },
  ])('$name', ({ options, expected }) => {
    expect(keysOf(listPage(objects, options))).toMatchObject(expected);
  });

  it('continuation token 可以來回轉換（含非 ASCII）', () => {
    expect(decodeContinuationToken(encodeContinuationToken('角色/圖 1.png'))).toBe('角色/圖 1.png');
  });

  it('prefix 在中段：結果正確，而且只讀到 prefix 範圍附近的項目（二分搜尋定位）', () => {
    let reads = 0;
    const many = Array.from({ length: 10_000 }, (_, i) => {
      const key = `files/${String(i).padStart(5, '0')}`;
      return {
        get key() {
          reads += 1;
          return key;
        },
      };
    });
    const page = listPage(many, {
      prefix: 'files/0500',
      delimiter: undefined,
      after: 'files/05003',
      maxKeys: 1000,
    });
    expect(page.contents.map((object) => object.key)).toEqual([
      'files/05004',
      'files/05005',
      'files/05006',
      'files/05007',
      'files/05008',
      'files/05009',
    ]);
    expect(reads).toBeLessThan(200);
  });

  it('lowerBoundUtf8：依 UTF-8 位元組序找第一個 ≥（strict 時 >）目標的位置', () => {
    const sorted = ['a', 'b', 'b', 'c', 'ｚ', '😀'].map((key) => ({ key }));
    expect(lowerBoundUtf8(sorted, 'b', false)).toBe(1);
    expect(lowerBoundUtf8(sorted, 'b', true)).toBe(3);
    expect(lowerBoundUtf8(sorted, '', false)).toBe(0);
    expect(lowerBoundUtf8(sorted, 'z', false)).toBe(4);
    expect(lowerBoundUtf8(sorted, '😀', true)).toBe(6);
  });
});
