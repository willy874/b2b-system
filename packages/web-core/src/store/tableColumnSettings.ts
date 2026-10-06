import { SELECT_COLUMN_ID } from '@b2b-system/ui/Table';
import { createChannel } from '@b2b-system/web-shared/channel';
import type { Channel, ChannelOptions } from '@b2b-system/web-shared/channel';
import { create } from '@b2b-system/web-shared/hooks';
import { createDictStorage } from '@b2b-system/web-shared/storage';
import type { DictStorageMessages } from '@b2b-system/web-shared/storage';

/** 欄位固定在哪一側：`start` 是左、`end` 是右（對應 TanStack 的 left / right）。 */
export type ColumnPinSide = 'start' | 'end';
/** 資料列釘選在哪一側：`top` 是表格頂端、`bottom` 是底端。 */
export type RowPinSide = 'top' | 'bottom';

/** `RichTable` 的操作欄 id：不列入順序設定，但可以固定，預設固定在 `end`。 */
export const ACTIONS_COLUMN_ID = 'actions';
/** `RichTable` 的釘選欄（PinColumn）id：可以設定，預設隱藏。 */
export const ROW_PIN_COLUMN_ID = '__pin';
export { SELECT_COLUMN_ID };

/** 一張表的欄位設定：可設定欄位的顯示順序、被隱藏的欄位，以及水平／垂直捲動時要固定的部分。 */
export interface TableColumnSettings {
  order: string[];
  hidden: string[];
  /** 欄位 id → 固定在哪一側；沒有列出的欄位不固定。 */
  pinnedColumns: Record<string, ColumnPinSide>;
  /** 垂直捲動時表頭留在上方；表格會變成有最大高度的捲動框。 */
  stickyHeader: boolean;
}

/** 存在 localStorage 的形狀：固定設定是後來才加的，舊資料沒有這兩個欄位。 */
export type StoredTableColumnSettings = Pick<TableColumnSettings, 'order' | 'hidden'> &
  Partial<Pick<TableColumnSettings, 'pinnedColumns' | 'stickyHeader'>>;

/** 勾選欄（CheckboxColumn）固定在 `start`、操作欄固定在 `end`。 */
export const DEFAULT_PINNED_COLUMNS: Readonly<Record<string, ColumnPinSide>> = {
  [SELECT_COLUMN_ID]: 'start',
  [ACTIONS_COLUMN_ID]: 'end',
};
/** 工具欄（勾選欄、釘選欄）：永遠排在一般欄位前面，已存過設定的表新加它們時也插在最前面。 */
const UTILITY_COLUMN_IDS: ReadonlySet<string> = new Set([SELECT_COLUMN_ID, ROW_PIN_COLUMN_ID]);

/** 每張表都預設隱藏的欄位（與各表登記的 `defaultHidden` 合併）。 */
export const DEFAULT_HIDDEN_COLUMNS: readonly string[] = [ROW_PIN_COLUMN_ID];
export const DEFAULT_STICKY_HEADER = false;

/**
 * 釘選的資料列：存進 localStorage 的只有 id 與側邊，**不存資料本身**——伺服器資料的複本不能落地，
 * 也不能留給下一個登入的人（docs/architecture/frontend/09-state-and-storage.md §3.3、§4.2）。
 * 與欄位設定分開存：「恢復預設」只重設欄位，不會清掉釘選的列。
 */
export interface PinnedRow {
  id: string;
  side: RowPinSide;
}

type TableColumnSettingsMap = Record<string, StoredTableColumnSettings>;
type PinnedRowsMap = Record<string, PinnedRow[]>;
/** 表格 id → 列 id → 釘選當下的資料。只在本分頁的記憶體，session 結束時清掉（`clearPinnedRowData`）。 */
type PinnedRowDataMap = Record<string, Record<string, unknown>>;

const SETTINGS_KEY = 'tables';
const PINNED_ROWS_KEY = 'pinnedRows';

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

/** 只留 id 與側邊：舊版本存過整筆資料（`row`），讀到就丟掉。 */
function toPinnedRowsMap(value: unknown): PinnedRowsMap {
  if (!isPinnedRowsMap(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([tableId, rows]) => [
      tableId,
      rows.map(({ id, side }) => ({ id, side })),
    ]),
  );
}

function hasStoredRowData(value: unknown): boolean {
  return (
    isPinnedRowsMap(value) &&
    Object.values(value).some((rows) => rows.some((entry) => 'row' in entry))
  );
}

function readPinnedRows(): PinnedRowsMap {
  const value = storage.get<unknown>(PINNED_ROWS_KEY, {});
  const pinnedRows = toPinnedRowsMap(value);
  // 舊版本存在 localStorage 的整筆資料：改寫成只有 id 與側邊，不留在這台裝置上
  if (hasStoredRowData(value)) storage.set(PINNED_ROWS_KEY, pinnedRows);
  return pinnedRows;
}

interface TableColumnSettingsStore {
  settings: TableColumnSettingsMap;
  pinnedRows: PinnedRowsMap;
  /**
   * 釘選當下的資料：換到別頁（資料不在目前的 `data` 裡）時仍能顯示那一列。只在記憶體——
   * 重新整理或換分頁之後沒有，那些列要回到它們所在的頁才會顯示（id 仍記著）。
   */
  pinnedRowData: PinnedRowDataMap;
  setTableSettings: (tableId: string, next: StoredTableColumnSettings) => void;
  resetTableSettings: (tableId: string) => void;
  /** 釘選（或改到另一側）一列；同一列只會出現一次，改側時移到該側的最後。`row` 只留在記憶體。 */
  pinRow: (tableId: string, id: string, side: RowPinSide, row: unknown) => void;
  unpinRow: (tableId: string, id: string) => void;
  clearPinnedRows: (tableId: string) => void;
}

export const useTableColumnSettingsStore = create<TableColumnSettingsStore>((set, get) => ({
  settings: readSettings(),
  pinnedRows: readPinnedRows(),
  pinnedRowData: {},
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
  pinRow: (tableId, id, side, row) => {
    const { pinnedRows, pinnedRowData } = get();
    const rest = (pinnedRows[tableId] ?? []).filter((entry) => entry.id !== id);
    writePinnedRows(
      { ...pinnedRows, [tableId]: [...rest, { id, side }] },
      { ...pinnedRowData, [tableId]: { ...pinnedRowData[tableId], [id]: row } },
    );
  },
  unpinRow: (tableId, id) => {
    const { pinnedRows, pinnedRowData } = get();
    const rest = (pinnedRows[tableId] ?? []).filter((entry) => entry.id !== id);
    const { [tableId]: _removed, ...others } = pinnedRows;
    const { [id]: _row, ...tableData } = pinnedRowData[tableId] ?? {};
    writePinnedRows(rest.length > 0 ? { ...others, [tableId]: rest } : others, {
      ...pinnedRowData,
      [tableId]: tableData,
    });
  },
  clearPinnedRows: (tableId) => {
    const { [tableId]: _removed, ...pinnedRows } = get().pinnedRows;
    const { [tableId]: _data, ...pinnedRowData } = get().pinnedRowData;
    writePinnedRows(pinnedRows, pinnedRowData);
  },
}));

/** localStorage 只寫 id 與側邊；資料只進記憶體的 `pinnedRowData`。 */
function writePinnedRows(pinnedRows: PinnedRowsMap, pinnedRowData: PinnedRowDataMap): void {
  storage.set(PINNED_ROWS_KEY, pinnedRows);
  useTableColumnSettingsStore.setState({ pinnedRows, pinnedRowData });
}

/**
 * 清掉釘選列在記憶體裡的資料（session 結束時，web-core 的 `SessionWatcher`）：那是以上一個人的身分取得的，
 * 下一個在同一個分頁登入的人不能看到。釘選的 id 與側邊是這台裝置的版面偏好，保留。
 */
export function clearPinnedRowData(): void {
  useTableColumnSettingsStore.setState({ pinnedRowData: {} });
}

/**
 * 表格掛載期間收其他分頁的變更；掛載時先重讀一次，補上沒在收訊期間錯過的寫入。
 * 回傳停止收訊的函式（給 `useEffect` 用）。
 */
export function syncTableColumnSettings(): () => void {
  useTableColumnSettingsStore.setState({ settings: readSettings(), pinnedRows: readPinnedRows() });
  // 其他分頁送來的值無法信任型別（新舊版本並存），不合法就當作沒有設定
  const offs = [
    storage.subscribe(SETTINGS_KEY, (value) => {
      useTableColumnSettingsStore.setState({ settings: isSettingsMap(value) ? value : {} });
    }),
    storage.subscribe(PINNED_ROWS_KEY, (value) => {
      useTableColumnSettingsStore.setState({ pinnedRows: toPinnedRowsMap(value) });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/**
 * 把存下來的設定套到目前的欄位上：已經不存在的欄位丟掉、新加的欄位接在最後（工具欄插在最前面）。
 * 預設值（沒有存過設定、或新加的欄位）：隱藏 `defaultHidden` ＋ `DEFAULT_HIDDEN_COLUMNS`、
 * 固定 `DEFAULT_PINNED_COLUMNS`（勾選欄在 `start`、操作欄在 `end`）、表頭不固定。
 * `fixedColumnIds` 是不列入順序、但可以固定的欄位（操作欄）。
 */
export function resolveColumnSettings(
  columnIds: readonly string[],
  stored: StoredTableColumnSettings | undefined,
  defaultHidden: readonly string[] = [],
  fixedColumnIds: readonly string[] = [],
): TableColumnSettings {
  const known = new Set(columnIds);
  const pinnable = new Set([...columnIds, ...fixedColumnIds]);
  const hiddenByDefault = new Set([...defaultHidden, ...DEFAULT_HIDDEN_COLUMNS]);
  const stickyHeader = stored?.stickyHeader ?? DEFAULT_STICKY_HEADER;
  const keepPinnable = (pins: Record<string, ColumnPinSide>) =>
    Object.fromEntries(Object.entries(pins).filter(([id]) => pinnable.has(id)));

  if (!stored) {
    return {
      order: [...columnIds],
      hidden: columnIds.filter((id) => hiddenByDefault.has(id)),
      pinnedColumns: keepPinnable(DEFAULT_PINNED_COLUMNS),
      stickyHeader,
    };
  }

  const order = [...new Set(stored.order)].filter((id) => known.has(id));
  const placed = new Set(order);
  const added = columnIds.filter((id) => !placed.has(id));
  // 新加的工具欄插在最前面（依 columnIds 的順序），其餘新欄位接在最後
  order.unshift(...added.filter((id) => UTILITY_COLUMN_IDS.has(id)));
  order.push(...added.filter((id) => !UTILITY_COLUMN_IDS.has(id)));

  // 新加的欄位（存設定時還不存在）套用預設的隱藏與固定
  const hidden = [
    ...stored.hidden.filter((id) => known.has(id)),
    ...added.filter((id) => hiddenByDefault.has(id)),
  ];
  const addedPins = Object.fromEntries(
    added.flatMap((id) => (DEFAULT_PINNED_COLUMNS[id] ? [[id, DEFAULT_PINNED_COLUMNS[id]]] : [])),
  );
  const pinnedColumns = keepPinnable({
    ...(stored.pinnedColumns ?? DEFAULT_PINNED_COLUMNS),
    ...addedPins,
  });
  return { order, hidden, pinnedColumns, stickyHeader };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalPinnedColumns(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    isRecord(value) && Object.values(value).every((side) => side === 'start' || side === 'end')
  );
}

/** 舊版本的值多一個 `row`（整筆資料）：仍算合法，讀進來時由 `toPinnedRowsMap` 丟掉。 */
function isPinnedRowsMap(
  value: unknown,
): value is Record<string, Array<PinnedRow & { row?: unknown }>> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (rows) =>
      Array.isArray(rows) &&
      rows.every(
        (entry: unknown) =>
          isRecord(entry) &&
          typeof entry.id === 'string' &&
          (entry.side === 'top' || entry.side === 'bottom'),
      ),
  );
}

function isSettingsMap(value: unknown): value is TableColumnSettingsMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as Record<string, unknown>;
    return (
      isStringArray(record.order) &&
      isStringArray(record.hidden) &&
      isOptionalPinnedColumns(record.pinnedColumns) &&
      isOptionalBoolean(record.stickyHeader)
    );
  });
}
