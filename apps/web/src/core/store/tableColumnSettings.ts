import { createChannel } from '@/shared/channel';
import type { Channel, ChannelOptions } from '@/shared/channel';
import { createDictStorage } from '@/shared/storage';
import type { DictStorageMessages } from '@/shared/storage';
import { create } from '@/shared/store';

/** 一張表的欄位設定：可設定欄位的顯示順序，以及被隱藏的欄位。 */
export interface TableColumnSettings {
  order: string[];
  hidden: string[];
}

type TableColumnSettingsMap = Record<string, TableColumnSettings>;

const SETTINGS_KEY = 'tables';

/**
 * 欄位設定的跨分頁頻道：由下方的 dictStorage 持有，寫入即廣播。
 * 只同步本機分頁（不在伺服器中繼白名單內）：欄位設定是這台裝置的版面偏好。
 */
export function createTableColumnSettingsChannel(
  options?: ChannelOptions,
): Channel<DictStorageMessages> {
  return createChannel('store:table-column-settings:storage', options);
}

const storage = createDictStorage('table-column-settings', {
  channel: createTableColumnSettingsChannel(),
});

function readSettings(): TableColumnSettingsMap {
  const value = storage.get<unknown>(SETTINGS_KEY, {});
  return isSettingsMap(value) ? value : {};
}

interface TableColumnSettingsStore {
  settings: TableColumnSettingsMap;
  setTableSettings: (tableId: string, next: TableColumnSettings) => void;
  resetTableSettings: (tableId: string) => void;
}

export const useTableColumnSettingsStore = create<TableColumnSettingsStore>((set, get) => ({
  settings: readSettings(),
  setTableSettings: (tableId, next) => {
    const settings = { ...get().settings, [tableId]: next };
    storage.set(SETTINGS_KEY, settings);
    set({ settings });
  },
  resetTableSettings: (tableId) => {
    const { [tableId]: _removed, ...settings } = get().settings;
    storage.set(SETTINGS_KEY, settings);
    set({ settings });
  },
}));

/**
 * 表格掛載期間收其他分頁的變更；掛載時先重讀一次，補上沒在收訊期間錯過的寫入。
 * 回傳停止收訊的函式（給 `useEffect` 用）。
 */
export function syncTableColumnSettings(): () => void {
  useTableColumnSettingsStore.setState({ settings: readSettings() });
  return storage.subscribe(SETTINGS_KEY, (value) => {
    // 其他分頁送來的值無法信任型別（新舊版本並存），不合法就當作沒有設定
    useTableColumnSettingsStore.setState({ settings: isSettingsMap(value) ? value : {} });
  });
}

/**
 * 把存下來的設定套到目前的欄位上：已經不存在的欄位丟掉、新加的欄位接在最後並顯示。
 * 沒有存過設定時回傳預設值（欄位原本的順序，隱藏 `defaultHidden`）。
 */
export function resolveColumnSettings(
  columnIds: readonly string[],
  stored: TableColumnSettings | undefined,
  defaultHidden: readonly string[] = [],
): TableColumnSettings {
  if (!stored) {
    return { order: [...columnIds], hidden: defaultHidden.filter((id) => columnIds.includes(id)) };
  }
  const known = new Set(columnIds);
  const order = [...new Set(stored.order)].filter((id) => known.has(id));
  const placed = new Set(order);
  for (const id of columnIds) {
    if (!placed.has(id)) order.push(id);
  }
  return { order, hidden: stored.hidden.filter((id) => known.has(id)) };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSettingsMap(value: unknown): value is TableColumnSettingsMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      isStringArray((entry as Record<string, unknown>).order) &&
      isStringArray((entry as Record<string, unknown>).hidden),
  );
}
