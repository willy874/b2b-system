/**
 * 對外 API 程序固定的環境（docs/adr/0027-api-tokens-external-api.md D19）：只入列、不執行背景工作與排程。
 * 背景工作留在 api（之後拆成 worker）；同一份 env 給兩個程序用，所以在這裡覆寫，不靠部署記得設。
 *
 * 設定在 import 時就被讀進 ConfigModule：這個檔案必須是 `main.external.ts` 第一個 import 的專案檔。
 */
process.env.JOBS_WORKER_ENABLED = 'false';
