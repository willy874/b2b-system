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
   * 結束（完成、失敗、取消）後在 pg-boss 的表裡留幾秒，之後由 pg-boss 刪除；管理頁只看得到保留期內的。
   * 預設 7 天；每個事件、每個人各一筆的高流量工作用 `HIGH_VOLUME_RETENTION_SECONDS`。
   */
  deleteAfterSeconds: number;
  /**
   * 同一時間最多一筆在排隊、一筆在執行（pg-boss 的 `stately`）。排程工作用它避免上一輪沒跑完時越積越多；
   * 一般工作（例：寄信）每筆都要執行，不能開。
   */
  exclusive: boolean;
  /**
   * `tenant`（預設）：在某個租戶裡執行，入列時帶目前的租戶；排程觸發時展開成每個 `active` 租戶一筆。
   * `platform`：不屬於任何租戶（只碰平台 DB，例：清除 IdP 狀態），handler 裡沒有租戶脈絡
   * （docs/architecture/05-tenancy.md §10.2 D15）。
   */
  scope: 'tenant' | 'platform';
  /**
   * 這個程序同時執行幾筆（pg-boss 的 `localConcurrency`）。預設 1；等待外部服務為主的工作（寄信）調高，
   * 吃 CPU 或記憶體的工作（影像、封存）維持 1，免得拖慢同一個程序上的 API。
   */
  concurrency: number;
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

/**
 * 高流量工作（webhook 投遞、公告的事件點與分批寫入）的保留期：1 天。所有租戶的工作在同一張表，
 * 保留越久，管理頁的查詢與 pg-boss 的維護越慢（docs/architecture/backend/10-jobs.md §3）。
 */
export const HIGH_VOLUME_RETENTION_SECONDS = 24 * 60 * 60;

/** 一般工作的預設：重試 5 次，30 秒起跳、最多間隔 1 小時；結束後保留 7 天（pg-boss 的預設）。 */
const DEFAULT_JOB_OPTIONS: JobTypeOptions = {
  retryLimit: 5,
  retryDelaySeconds: 30,
  retryDelayMaxSeconds: 3600,
  expireInSeconds: 15 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  exclusive: false,
  scope: 'tenant',
  concurrency: 1,
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
