import { create } from '@b2b-system/web-shared/hooks';
import { createDictStorage } from '@b2b-system/web-shared/storage';

import type { PageKey } from '../permission';

/** 面板裡「最近造訪」最多列幾頁。 */
export const RECENT_PAGE_LIMIT = 5;

const storage = createDictStorage('commandPalette');
const RECENT_KEY = 'recentPages';

/**
 * 只存 page key：顯示名稱與路徑在讀取時從選單註冊表查，不存資料名稱等伺服器資料的複本
 * （docs/architecture/frontend/09-state-and-storage.md §4.2）。存的東西被竄改也只是字串，對不上就略過。
 */
function readRecentPages(): PageKey[] {
  const value: unknown = storage.get(RECENT_KEY, []);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is PageKey => typeof item === 'string')
    .slice(0, RECENT_PAGE_LIMIT);
}

interface RecentPageStore {
  /** 最近的在前。 */
  pages: PageKey[];
  record: (page: PageKey) => void;
}

export const useRecentPageStore = create<RecentPageStore>((set, get) => ({
  pages: readRecentPages(),
  record: (page) => {
    const current = get().pages;
    if (current[0] === page) return;
    const pages = [page, ...current.filter((item) => item !== page)].slice(0, RECENT_PAGE_LIMIT);
    storage.set(RECENT_KEY, pages);
    set({ pages });
  },
}));
