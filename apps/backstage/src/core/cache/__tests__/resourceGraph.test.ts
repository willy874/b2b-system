import { describe, expect, it } from 'vitest';

import { ANY_ID, createResourceGraph } from '../resourceGraph';

const graph = createResourceGraph<'post' | 'comment' | 'tag' | 'log' | 'link'>({
  post: {
    collection: ['POST_LIST'],
    entity: ['POST_DETAIL'],
    derivesFrom: [{ from: 'tag', kinds: ['update'], id: 'ref' }],
  },
  comment: {
    collection: ['COMMENT_LIST'],
    derivesFrom: [{ from: 'post', kinds: ['delete'], id: 'none' }],
  },
  tag: {
    collection: ['TAG_LIST'],
    entity: ['TAG_DETAIL'],
    derivesFrom: [{ from: 'link', id: 'self', when: (change) => change.id !== 'ignored' }],
  },
  log: { collection: ['LOG_LIST'], derivesFromAnyChange: true },
  link: {},
});

const keysOf = (targets: ReturnType<typeof graph.resolve>) =>
  targets.map((target) => `${target.action}:${target.queryKey.join('/')}`).toSorted();

describe('createResourceGraph（資源依賴圖）', () => {
  it('create 只失效 collection，不碰任何單筆', () => {
    expect(keysOf(graph.resolve([{ resource: 'post', kind: 'create' }]))).toEqual([
      'invalidate:LOG_LIST',
      'invalidate:POST_LIST',
    ]);
  });

  it('update 失效 collection 與那一筆', () => {
    expect(keysOf(graph.resolve([{ resource: 'post', kind: 'update', id: 'p1' }]))).toEqual([
      'invalidate:LOG_LIST',
      'invalidate:POST_DETAIL/p1',
      'invalidate:POST_LIST',
    ]);
  });

  it('delete 移除那一筆（不重抓），並觸發宣告了 delete 的衍生資源', () => {
    expect(keysOf(graph.resolve([{ resource: 'post', kind: 'delete', id: 'p1' }]))).toEqual([
      'invalidate:COMMENT_LIST',
      'invalidate:LOG_LIST',
      'invalidate:POST_LIST',
      'remove:POST_DETAIL/p1',
    ]);
  });

  it('ref：呼叫端給了 refs 就只失效那幾筆', () => {
    const targets = graph.resolve([
      { resource: 'tag', kind: 'update', id: 't1', refs: { post: ['p1', 'p2'] } },
    ]);
    expect(keysOf(targets)).toContain('invalidate:POST_DETAIL/p1');
    expect(keysOf(targets)).toContain('invalidate:POST_DETAIL/p2');
    expect(keysOf(targets)).not.toContain('invalidate:POST_DETAIL');
  });

  it('ref：沒給 refs 退回以前綴失效全部單筆', () => {
    const targets = graph.resolve([{ resource: 'tag', kind: 'update', id: 't1' }]);
    expect(keysOf(targets)).toContain('invalidate:POST_DETAIL');
  });

  it('ref：refs 為空陣列代表沒有受影響的那一方', () => {
    const targets = graph.resolve([
      { resource: 'tag', kind: 'update', id: 't1', refs: { post: [] } },
    ]);
    expect(keysOf(targets).some((key) => key.includes('POST'))).toBe(false);
  });

  it('kinds 不符的變更不會傳到衍生資源', () => {
    const targets = graph.resolve([{ resource: 'tag', kind: 'create' }]);
    expect(keysOf(targets).some((key) => key.includes('POST'))).toBe(false);
  });

  it('when 為 false 時不傳遞', () => {
    expect(keysOf(graph.resolve([{ resource: 'link', kind: 'update', id: 'ignored' }]))).toEqual([
      'invalidate:LOG_LIST',
    ]);
  });

  it('只走一層：衍生出的 tag 變更不會再擴散到 post', () => {
    const targets = graph.resolve([{ resource: 'link', kind: 'update', id: 't1' }]);
    expect(keysOf(targets)).toEqual([
      'invalidate:LOG_LIST',
      'invalidate:TAG_DETAIL/t1',
      'invalidate:TAG_LIST',
    ]);
  });

  it('前綴已失效時不再重複列出單筆', () => {
    const targets = graph.resolve([
      { resource: 'post', kind: 'update', id: 'p1' },
      { resource: 'post', kind: 'update', id: ANY_ID },
    ]);
    expect(keysOf(targets)).toEqual([
      'invalidate:LOG_LIST',
      'invalidate:POST_DETAIL',
      'invalidate:POST_LIST',
    ]);
  });

  it('資源不能衍生自自己', () => {
    expect(() =>
      createResourceGraph<'a'>({ a: { derivesFrom: [{ from: 'a', id: 'self' }] } }),
    ).toThrow();
  });
});
