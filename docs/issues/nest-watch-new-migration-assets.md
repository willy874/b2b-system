# `nest start --watch` 不會複製新加的 migration 到 `dist`

## 現況

`apps/api/nest-cli.json` 以 `compilerOptions.assets` 把 `db/migrations/**/*.sql`、`meta/*.json`（租戶與平台兩條線）複製到 `dist`，
但沒有設 `watchAssets`。Nest CLI 只在啟動時複製一次 assets，watch 期間新增的檔案不會跟著複製。

2026-10-06 加租戶 migration `0034_notification_policy_override_check.sql` 時，正在跑的 `pnpm dev`（`nest start --watch`）
因為 `_journal.json` 是在啟動前就存在的檔案、內容卻沒有同步，佈建新租戶時 `migrateTenantDatabase`
（`apps/api/src/db/provision.ts`）回 `No file …/dist/src/db/migrations/0034_….sql found`，租戶停在佈建失敗；
E2E 的 `tenancy.spec.ts` 因此逾時。`pnpm db:migrate`（tsx 直接讀 `src/`）不受影響，所以既有租戶看起來正常。

## 影響

只影響開發：加了 migration 卻沒重啟 api 的人，在本機建立租戶會失敗，錯誤訊息不會直接指向「要重啟」。
與並行的對話共用工作目錄時，別人加的 migration 也會讓你的 watch 程序壞掉。

## 修正方式

`apps/api/nest-cli.json` 的 `compilerOptions` 加 `"watchAssets": true`。
要確認它與 `deleteOutDir: true` 搭配時，修改既有 `_journal.json` 也會重新複製（journal 是改檔，不是新增）。

## 驗證方式

`pnpm dev` 跑著時以 `pnpm --filter @b2b-system/api exec drizzle-kit generate --custom --name probe` 加一個空 migration，
不重啟 api，確認 `apps/api/dist/src/db/migrations/` 出現新檔、`meta/_journal.json` 已更新；
再到 apps/platform 建立一個租戶，確認佈建成功。驗完刪掉這個 migration 與 journal 的那一筆。
