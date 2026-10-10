import { describe, expect, it } from 'vitest';

import { createPageSnapshots } from '../pageSnapshots';
import type { SnapshotSource } from '../pageSnapshots';

interface Item {
  id: string;
  v?: number;
}

const page = (ids: string[], nextCursor: string | null = 'next', v?: number) => ({
  items: ids.map((id) => ({ id, v })),
  nextCursor,
});

function source(pages: Array<ReturnType<typeof page>>, firstIndex: number): SnapshotSource<Item> {
  return { pages, pageParams: pages.map((_, position) => ({ index: firstIndex + position })) };
}

const ids = (items: readonly Item[]) => items.map((item) => item.id);

describe('createPageSnapshots（被 maxPages 丟掉的頁的快照）', () => {
  it('往下捲丟掉前面的頁：前面的頁以快照保留、標成 before', () => {
    const snapshots = createPageSnapshots<Item>();
    snapshots.merge('k', source([page(['a', 'b']), page(['c', 'd'])], 0));
    const merged = snapshots.merge('k', source([page(['c', 'd']), page(['e'], null)], 1));

    expect(ids(merged.items)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...merged.stale]).toEqual([
      ['a', 'before'],
      ['b', 'before'],
    ]);
  });

  it('往回捲丟掉後面的頁：後面的頁以快照保留、標成 after', () => {
    const snapshots = createPageSnapshots<Item>();
    snapshots.merge('k', source([page(['c']), page(['d'])], 1));
    const merged = snapshots.merge('k', source([page(['b']), page(['c'])], 0));

    expect(ids(merged.items)).toEqual(['b', 'c', 'd']);
    expect(merged.stale.get('d')).toBe('after');
    expect(merged.stale.has('b')).toBe(false);
  });

  it('保留的頁以最新的資料覆蓋快照；與快照重疊的項目以保留的頁為準、不重複', () => {
    const snapshots = createPageSnapshots<Item>();
    snapshots.merge('k', source([page(['a', 'b'], 'n', 1), page(['c', 'd'], 'n', 1)], 0));
    snapshots.merge('k', source([page(['c', 'd'], 'n', 1)], 1));
    // 取回第 0 頁時內容變了：b 被刪、c 往前移進第 0 頁
    const merged = snapshots.merge('k', source([page(['a', 'c'], 'n', 2), page(['d'], 'n', 2)], 0));

    expect(ids(merged.items)).toEqual(['a', 'c', 'd']);
    expect(merged.items.every((item) => item.v === 2)).toBe(true);
    expect(merged.stale.size).toBe(0);
  });

  it('保留的最後一頁已是最後一頁時，之後的快照丟掉（例：別人刪了圖片）', () => {
    const snapshots = createPageSnapshots<Item>();
    snapshots.merge('k', source([page(['c']), page(['d'])], 1));
    snapshots.merge('k', source([page(['b']), page(['c'])], 0));
    const merged = snapshots.merge('k', source([page(['b']), page(['c'], null)], 0));

    expect(ids(merged.items)).toEqual(['b', 'c']);
    expect(merged.stale.size).toBe(0);
  });

  it('換了查詢條件就清空；沒有資料時是空的', () => {
    const snapshots = createPageSnapshots<Item>();
    snapshots.merge('k', source([page(['a']), page(['b'])], 0));
    snapshots.merge('k', source([page(['b'])], 1));
    expect(ids(snapshots.merge('other', source([page(['x'])], 1)).items)).toEqual(['x']);
    expect(snapshots.merge('other', undefined)).toEqual({ items: [], stale: new Map() });
  });
});
