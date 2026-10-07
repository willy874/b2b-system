import { describe, expect, it } from 'vitest';

import type { FileListPage } from '@/shared/api-sdk';

import { FILE_INFINITE_MAX_PAGES, getFileInfiniteListQueryOptions } from '../query';

const page = (nextCursor: string | null, prevCursor: string | null): FileListPage => ({
  items: [],
  pagination: { offset: 0, limit: 20, total: null },
  nextCursor,
  prevCursor,
});

describe('檔案的無限捲動（docs/architecture/frontend/12-file-manager.md §5）', () => {
  const options = getFileInfiniteListQueryOptions({ params: { filters: {}, limit: 20 } });

  it('只保留最近 10 頁；頁參數帶著從頭數來的頁碼', () => {
    expect(options.maxPages).toBe(FILE_INFINITE_MAX_PAGES);
    expect(options.initialPageParam).toEqual({ cursor: undefined, index: 0 });
  });

  it('往後取：下一頁的頁碼 +1；沒有 nextCursor 就是最後一頁', () => {
    expect(
      options.getNextPageParam(page('n', null), [], { cursor: undefined, index: 3 }, []),
    ).toEqual({
      cursor: 'n',
      index: 4,
    });
    expect(
      options.getNextPageParam(page(null, null), [], { cursor: undefined, index: 3 }, []),
    ).toBeUndefined();
  });

  it('往前取：以 prevCursor 抓回前一頁，頁碼 −1；沒有 prevCursor 就是最前面', () => {
    expect(
      options.getPreviousPageParam?.(page(null, 'p'), [], { cursor: 'x', index: 3 }, []),
    ).toEqual({
      cursor: 'p',
      index: 2,
    });
    expect(
      options.getPreviousPageParam?.(page(null, null), [], { cursor: undefined, index: 0 }, []),
    ).toBeUndefined();
  });
});
