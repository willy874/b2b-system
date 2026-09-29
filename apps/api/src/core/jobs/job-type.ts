/** 工作類型的執行設定；除了 `scope` 都對應 pg-boss 的佇列選項（docs/architecture/backend/10-jobs.md §3）。 */
export interface JobTypeOptions {
  /** 失敗後最多重試幾次；用完就停在 `failed`，由管理頁手動重試。 */
  retryLimit: number;
  /** 第一次重試前等幾秒；之後指數退避，最多 `retryDelayMaxSeconds`。 */
  retryDelaySeconds: number;
  retryDelayMaxSeconds: number;
  /** 一次執行最多幾秒；超過視為失敗（會重試）。 */
  expireInSeconds: number;
  /**
   * 同一時間最多一筆在排隊、一筆在執行（pg-boss 的 `stately`）。排程工作用它避免上一輪沒跑完時越積越多；
   * 一般工作（例：寄信）每筆都要執行，不能開。
   */
  exclusive: boolean;
  /**
   * `tenant`（預設）：在某個租戶裡執行，入列時帶目前的租戶；排程觸發時展開成每個 `active` 租戶一筆。
   * `platform`：不屬於任何租戶（只碰平台 DB，例：清除 IdP 狀態），handler 裡沒有租戶脈絡
   * （docs/adr/0020-physical-tenant-isolation.md D15）。
   */
  scope: 'tenant' | 'platform';
}

/**
 * 一種背景工作：名稱 ＋ 資料型別 ＋ 執行設定。由擁有它的模組以 `defineJob()` 宣告並匯出；
 * 入列端 import 它，handler 由同一個模組在 `onModuleInit` 以 `JobQueue.register()` 註冊。
 */
export interface JobType<TData extends object> {
  /** `<模組>.<動作>`，例：`auditLog.archive`；同時是 pg-boss 的佇列名稱，已上線後不改名。 */
  readonly name: string;
  readonly options: JobTypeOptions;
  /** 只用來攜帶資料型別，執行期不存在。 */
  readonly dataType?: TData;
}

/** 一般工作的預設：重試 5 次，30 秒起跳、最多間隔 1 小時。 */
const DEFAULT_JOB_OPTIONS: JobTypeOptions = {
  retryLimit: 5,
  retryDelaySeconds: 30,
  retryDelayMaxSeconds: 3600,
  expireInSeconds: 15 * 60,
  exclusive: false,
  scope: 'tenant',
};

const JOB_NAME_PATTERN = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

/** 宣告一種背景工作。名稱格式不對在模組載入時就失敗，不會等到第一次入列。 */
export function defineJob<TData extends object>(
  name: string,
  options: Partial<JobTypeOptions> = {},
): JobType<TData> {
  if (!JOB_NAME_PATTERN.test(name)) {
    throw new Error(`工作名稱 ${name} 必須是 <模組>.<動作>（camelCase，例：auditLog.archive）`);
  }
  return { name, options: { ...DEFAULT_JOB_OPTIONS, ...options } };
}
