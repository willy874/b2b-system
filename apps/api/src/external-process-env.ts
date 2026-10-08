/**
 * 對外 API 程序固定的環境（docs/architecture/06-external-api.md §9.2 D19）：
 * - 只有 `http` 角色：只入列、不執行背景工作與排程（docs/architecture/01-system.md §7）
 * - 環境變數驗證以對外 API 的範圍檢查：production 不要求這個程序用不到的金鑰（§6）
 *
 * 同一份 env 給兩個程序用，所以在這裡覆寫，不靠部署記得設。
 * 設定在 import 時就被讀進 ConfigModule：這個檔案必須是 `main.external.ts` 第一個 import 的專案檔。
 */
process.env.APP_ROLES = 'http';
process.env.JOBS_WORKER_ENABLED = 'false';
process.env.API_SURFACE = 'external';
