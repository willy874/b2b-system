import { createChannel } from '@b2b-system/web-shared/channel';
import type { Channel, ChannelOptions } from '@b2b-system/web-shared/channel';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { create } from '@b2b-system/web-shared/hooks';
import { createDictStorage } from '@b2b-system/web-shared/storage';
import type { DictStorageMessages } from '@b2b-system/web-shared/storage';

import type { FileSortField } from '@/apis/file/types';

import { FILE_PAGE_SIZES, FILE_SORT_FIELDS } from './constants';

/** 排列方式：圖示卡片或列表。 */
export type FileViewMode = 'grid' | 'list';
/** 閱覽模式：分頁或無限捲動。 */
export type FilePagingMode = 'pagination' | 'infinite';

export interface FileViewPreference {
  viewMode: FileViewMode;
  pagingMode: FilePagingMode;
  sort: SortEntry<FileSortField>;
  pageSize: number;
}

export const DEFAULT_FILE_VIEW_PREFERENCE: FileViewPreference = {
  viewMode: 'grid',
  pagingMode: 'infinite',
  sort: { sort: 'createdAt', order: 'desc' },
  pageSize: 60,
};

const KEY = 'view';

/**
 * 檔案管理器偏好的跨分頁頻道：由下方的 dictStorage 持有，寫入即廣播。
 * 只同步本機分頁（不在伺服器中繼白名單內）：排列方式是這台裝置的版面偏好（同表格欄位設定）。
 */
export function createFileViewPreferenceChannel(
  options?: ChannelOptions,
): Channel<DictStorageMessages> {
  return createChannel('store:file-view:storage', options);
}

const storage = createDictStorage('file-view', { channel: createFileViewPreferenceChannel() });

/** 其他分頁、舊版本存下的值不可信任：逐欄檢查，不合法的欄位退回預設值。 */
export function parseFileViewPreference(value: unknown): FileViewPreference {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const sort = record.sort as Partial<SortEntry<string>> | undefined;
  return {
    viewMode:
      record.viewMode === 'grid' || record.viewMode === 'list'
        ? record.viewMode
        : DEFAULT_FILE_VIEW_PREFERENCE.viewMode,
    pagingMode:
      record.pagingMode === 'pagination' || record.pagingMode === 'infinite'
        ? record.pagingMode
        : DEFAULT_FILE_VIEW_PREFERENCE.pagingMode,
    sort:
      sort &&
      (FILE_SORT_FIELDS as readonly string[]).includes(sort.sort ?? '') &&
      (sort.order === 'asc' || sort.order === 'desc')
        ? { sort: sort.sort as FileSortField, order: sort.order }
        : DEFAULT_FILE_VIEW_PREFERENCE.sort,
    pageSize: (FILE_PAGE_SIZES as readonly unknown[]).includes(record.pageSize)
      ? (record.pageSize as number)
      : DEFAULT_FILE_VIEW_PREFERENCE.pageSize,
  };
}

/**
 * `parseFileViewPreference` 每次都建新的 `sort` 物件；排序的值沒變時沿用原本的物件。
 * store 以 `Object.is` 比對欄位：換了參考，依賴 `sort` 的 memo 與 effect 都會以為排序變了，
 * 例如只切換排列方式（卡片／列表）就清空選取（docs/architecture/frontend/12-file-manager.md §4）。
 */
function keepSortReference(
  previous: FileViewPreference,
  next: FileViewPreference,
): FileViewPreference {
  return previous.sort.sort === next.sort.sort && previous.sort.order === next.sort.order
    ? { ...next, sort: previous.sort }
    : next;
}

export interface FileViewPreferenceStore extends FileViewPreference {
  update: (patch: Partial<FileViewPreference>) => void;
}

/** 排列方式、閱覽模式、排序、每頁筆數：記在 localStorage，下次打開沿用。 */
export const useFileViewPreferenceStore = create<FileViewPreferenceStore>((set, get) => ({
  ...parseFileViewPreference(storage.get<unknown>(KEY, undefined)),
  update: (patch) => {
    const { update: _update, ...current } = get();
    const next = keepSortReference(current, parseFileViewPreference({ ...current, ...patch }));
    storage.set(KEY, next);
    set(next);
  },
}));

/** 套用其他分頁（或 localStorage）的值：排序沒變時沿用原本的物件。 */
function applyStoredPreference(value: unknown): void {
  const { update: _update, ...current } = useFileViewPreferenceStore.getState();
  useFileViewPreferenceStore.setState(keepSortReference(current, parseFileViewPreference(value)));
}

/**
 * 頁面掛載期間收其他分頁的變更；掛載時先重讀一次，補上沒在收訊期間錯過的寫入。
 * 回傳停止收訊的函式（給 `useEffect` 用）。
 */
export function syncFileViewPreference(): () => void {
  applyStoredPreference(storage.get<unknown>(KEY, undefined));
  return storage.subscribe(KEY, applyStoredPreference);
}
