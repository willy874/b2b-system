import type { ResourceChangeWire } from '@b2b-system/realtime';
import type { ZodType } from 'zod';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Transaction } from '@/core/database';
import type { TenantFeature } from '@/core/tenant';

/**
 * 可匯入匯出的資源的定義（docs/architecture/backend/22-data-transfer.md §5）。擁有者模組在 `onModuleInit`
 * 以 `DataTransferRegistry.register()` 登記；`modules/data-transfer` 不 import 業務模組。
 */

export const TRANSFER_LOCALES = ['zh-TW', 'en-US'] as const;
export type TransferLocale = (typeof TRANSFER_LOCALES)[number];
export type LocalizedText = Readonly<Record<TransferLocale, string>>;

export const TRANSFER_DIRECTIONS = ['export', 'import'] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

export const IMPORT_MODES = ['create', 'update'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const EXPORT_FORMATS = ['csv', 'xlsx', 'json', 'yaml', 'sql'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 可以匯入的檔案格式，也是範本的格式（SQL 不能匯入，所以沒有）。 */
export const IMPORT_FORMATS = ['csv', 'xlsx', 'json', 'yaml'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** 結果報告的格式：表格（多出「列號」「結果」「錯誤」三欄，修正後直接重新上傳）。 */
export const SHEET_FORMATS = ['csv', 'xlsx'] as const;
export type SheetFormat = (typeof SHEET_FORMATS)[number];

export const TRANSFER_STATUSES = [
  'queued',
  'running',
  'applying',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const ROW_OUTCOMES = ['pending', 'succeeded', 'failed', 'skipped', 'cancelled'] as const;
export type RowOutcome = (typeof ROW_OUTCOMES)[number];

export type ColumnKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  /** 固定選項（例：使用者狀態） */
  | 'enum'
  /** 指向其他資源的名稱（例：角色）；匯入時解析成 id */
  | 'reference'
  /** 只匯出（例：稽核日誌的 changes、metadata） */
  | 'json';

export interface TransferEnumOption {
  value: string;
  label: LocalizedText;
  aliases?: readonly string[];
}

/** 參照解析的結果：對上一筆，或同名多筆（`ambiguous`）。沒對上的名稱不出現在 Map 裡。 */
export type ResolvedReference = { id: string; label: string } | 'ambiguous';

export interface ReferenceSpec {
  /** 名稱、代碼（slug）或 id，完全相符（不分大小寫）。回傳的 key 是正規化（trim、小寫）後的輸入。 */
  resolve(
    names: readonly string[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<string, ResolvedReference>>;
  /** 預覽中的下拉選單。 */
  search(keyword: string, ctx: TransferContext): Promise<readonly { id: string; label: string }[]>;
  /**
   * 新增模式：也可以指向 **同一份檔案** 裡其他列要新增的紀錄，以那一列 `column` 欄（唯一欄）的值引用（§7.8）。
   * 例：部門的「上層」填檔案裡另一列的代碼。套用時依相依順序先建立被指向的列；只能用在單一值的欄位。
   */
  sameFile?: { column: string };
}

export interface TransferColumnImport {
  modes: readonly ImportMode[];
  requiredOnCreate?: boolean;
  /** 修改模式的比對鍵，數字小的先比（id: 1、email: 2）。比對鍵只用來找目標，不會被修改。 */
  matchKey?: number;
  /** 修改模式能不能以 `\N` 清空。 */
  nullable?: boolean;
  /** 單一值的驗證；直接取用 API 的 DTO 欄位，不另寫。 */
  schema: ZodType;
  /** 狀態欄的合法轉移（目前值 → 可以改成的值）。 */
  transitions?: Readonly<Record<string, readonly string[]>>;
  /** 匯入這一欄額外要的權限（例：角色欄要 `user:assignRole`）。 */
  permission?: PermissionKey;
  /**
   * 文字欄的自動完成：依輸入查詢現有的值（例：修改模式以 Email 比對時，建議現有使用者的 Email）。
   * 沒有的欄位前端只以同一欄已經填過的值建議。
   */
  suggest?(keyword: string, ctx: TransferContext): Promise<readonly string[]>;
}

export interface TransferColumn<TRecord> {
  /** 穩定的機器鍵；發佈後不改名（舊的匯出檔要能匯回，標頭比對以它為準）。 */
  key: string;
  label: LocalizedText;
  /** 額外接受的標頭寫法（舊名、常見同義詞）。 */
  aliases?: readonly string[];
  kind: ColumnKind;
  /** 多值，以 `;` 分隔。 */
  multiple?: { max?: number };
  enum?: readonly TransferEnumOption[];
  reference?: ReferenceSpec;
  /** 「怎麼填」的補充說明（範本說明頁、表頭提示）。 */
  hint?: LocalizedText;
  /** 新增範本的範例值（原始字串）。 */
  example?: string;
  /** 讀這一欄要的權限；沒有就不出現在匯出、範本與預覽。 */
  permission?: PermissionKey;
  /** 匯出的值，以及修改模式比對「目前值」用的值（`reference` 回傳名稱）。 */
  export?: { get: (record: TRecord) => unknown };
  import?: TransferColumnImport;
}

export interface TransferContext {
  /** 建立者；工作裡由 `created_by` 重建。 */
  actor: AuthUser;
  locale: TransferLocale;
  timezone: string;
  /** 工作的關機／逾時，加上使用者取消。 */
  signal: AbortSignal;
  /** actor 持有的權限（super-admin 等同全部）。 */
  can(key: PermissionKey): boolean;
}

export type ExportScope<TFilter> =
  | { kind: 'ids'; ids: readonly string[] }
  | { kind: 'filter'; filter: TFilter };

export interface TransferExporter<TFilter, TRecord> {
  /** 匯出這種資源要的權限（例：`user:export`）。 */
  permissions: readonly PermissionKey[];
  /** 由列表的 query DTO 衍生（去掉分頁），沒有第二份篩選規則。 */
  filterSchema: ZodType<TFilter>;
  /** 勾選範圍的 id 格式（使用者是 uuid、稽核日誌是 bigint 字串）。 */
  idSchema: ZodType<string>;
  /** 檔案內的列序說明（例：「依建立時間排序」），對話框顯示。 */
  orderHint?: LocalizedText;
  /** 以 keyset 逐頁讀，以 ctx.actor 的權限過濾。 */
  iterate(scope: ExportScope<TFilter>, ctx: TransferContext): AsyncIterable<readonly TRecord[]>;
  /** 預估筆數：上限檢查與進度；可以是上限截斷的估計。 */
  count(scope: ExportScope<TFilter>, ctx: TransferContext): Promise<number>;
  /** 篩選條件的額外檢查（例：稽核日誌的日期範圍）；拋 `AppException`。 */
  assertFilter?(filter: TFilter): void;
}

/** 一個問題：錯誤或警告，以代碼＋參數表示，前端翻譯（§9.5）。 */
export interface RowIssue {
  column: string | null;
  code: string;
  params?: Readonly<Record<string, unknown>>;
  severity: 'error' | 'warning';
}

/** 修改模式比對到的紀錄。 */
export interface MatchResult<TRecord> {
  id: string;
  label: string;
  version: number;
  record: TRecord;
  /** 關聯欄的樂觀鎖輸入（例：`{ roleIds }`），套用時原樣送回。 */
  expected?: Readonly<Record<string, unknown>>;
}

/** 依比對鍵找目標的輸入：一列的比對鍵值（已正規化）。 */
export interface MatchKeys {
  column: string;
  value: string;
}

/** 轉換後的一列：`values` 只含有填（或 `\N`）的欄位；`reference` 是 id（多值是 id 陣列）。 */
export interface ResolvedRow {
  rowNo: number;
  values: Readonly<Record<string, unknown>>;
  /** 修改模式：比對到的目標與有變更的欄位。 */
  target?: MatchResult<unknown>;
  changed?: readonly string[];
}

export interface ApplyTarget {
  id: string;
  version: number;
  expected?: Readonly<Record<string, unknown>>;
}

export type AfterCommitEffect =
  /** 多列只做一次；`userIds` 合併後交給 `permissionsChanged()`（例：補建取得檔案權限的人的個人資料夾） */
  | { kind: 'permissionsChanged'; userIds?: readonly string[] }
  /** 合併後分批推播 */
  | { kind: 'resourceChanged'; change: ResourceChangeWire; affectedUserIds?: readonly string[] }
  /** 同一個 key 只跑一次 */
  | { kind: 'custom'; key: string; run: () => Promise<void> | void };

export interface ApplyResult {
  id: string;
  /** 修改模式：實際寫入的原值與新值。 */
  changes?: Readonly<Record<string, readonly [unknown, unknown]>>;
  after?: readonly AfterCommitEffect[];
}

export interface TransferImporter<TRecord> {
  modes: Partial<Record<ImportMode, { permissions: readonly PermissionKey[] }>>;
  /** 唯一欄：檔案內重複（前端與套用時）與資料庫重複（新增模式）的檢查。 */
  uniqueColumns?: readonly string[];
  /** 新增模式：已存在的值（key 是正規化後的值）。 */
  findExisting?(
    column: string,
    values: readonly string[],
    ctx: TransferContext,
  ): Promise<ReadonlySet<string>>;
  /** 修改模式：依比對鍵找目標；一個比對鍵值可能命中多筆（名稱類的鍵）。以操作者的權限查，看不到的等同不存在。 */
  resolveTargets?(
    column: string,
    values: readonly string[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<string, readonly MatchResult<TRecord>[]>>;
  /** 資源特有的跨欄、跨列檢查；只回傳問題，不寫資料。 */
  validateRows?(
    mode: ImportMode,
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>>;
  /**
   * 修改模式：以 id 找使用者在預覽中手動選的目標（§7.5「手動指定比對目標」）；以操作者的權限查，看不到的等同不存在。
   * 沒有實作的資源不能手動指定。
   */
  findTargetsById?(
    ids: readonly string[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<string, MatchResult<TRecord>>>;
  /** 修改模式：比對目標的下拉選單（關鍵字搜尋，回傳 id 與顯示名稱）。 */
  searchTargets?(
    keyword: string,
    ctx: TransferContext,
  ): Promise<readonly { id: string; label: string; description?: string }[]>;
  /** 範本：修改模式抽樣的現有紀錄（以操作者的權限）。 */
  sampleRecords?(ctx: TransferContext, limit: number): Promise<readonly TRecord[]>;
  /** 套用一列；必須使用傳入的 tx，走與 API 相同的業務規則。 */
  create?(
    values: Readonly<Record<string, unknown>>,
    ctx: TransferContext,
    tx: Transaction,
  ): Promise<ApplyResult>;
  update?(
    target: ApplyTarget,
    patch: Readonly<Record<string, unknown>>,
    ctx: TransferContext,
    tx: Transaction,
  ): Promise<ApplyResult>;
}

export interface TransferResource<TFilter = unknown, TRecord = unknown> {
  type: string;
  /** 資源所屬的租戶 feature：關閉時這個資源不能匯入匯出（`FEATURE_DISABLED`）。 */
  feature?: TenantFeature;
  /** 檔名 `users-20261008-1430.csv`、SQL 的表名 `users_export`。 */
  fileBaseName: string;
  label: LocalizedText;
  columns: readonly TransferColumn<TRecord>[];
  exporter?: TransferExporter<TFilter, TRecord>;
  importer?: TransferImporter<TRecord>;
}

// oxlint-disable-next-line typescript/no-explicit-any -- 登記表存放各資源的定義，型別參數各不相同
export type AnyTransferResource = TransferResource<any, any>;
