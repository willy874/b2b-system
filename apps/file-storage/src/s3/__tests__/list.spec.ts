import { decodeContinuationToken, encodeContinuationToken, listPage } from '@/s3/list';

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
});
