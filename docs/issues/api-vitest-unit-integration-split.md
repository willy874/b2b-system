# api 的單元測試和整合測試共用一份 vitest 設定，跑任何一個單元測試都要先起 Postgres container

## 現況

`apps/api/vitest.config.ts`：

- `include`（L16）同時收 `src/**/*.spec.ts`（單元，140 個檔）與 `test/**/*.spec.ts`（整合，39 個檔）。
- `globalSetup: ['./test/global-setup.ts']`（L17）：每次 `vitest run` 都會執行 `test/global-setup.ts` 的 `setup()`（L41 起），用 Testcontainers 起 `postgres:17-alpine`、建兩個 database、跑兩條 migration、登記測試租戶。
- `setupFiles: ['./test/setup-env.ts']`（L18）：每個測試檔都 `inject()` global setup 提供的值。
- `fileParallelism: false`（L27）：註解說是為了讓整合測試共用 container，但這個設定同時套用到全部單元測試。

`src/` 底下只有一個檔需要資料庫：`src/db/seeds/__tests__/seed.spec.ts`（import `test/db` 的 `createTestDatabase()`）。

[`backend/07-testing.md`](../architecture/backend/07-testing.md) §1 把測試分成單元（不用資料庫、數量多）與整合（Testcontainers）兩層，設定卻沒有照這個分開。

## 影響

- 只想跑一個單元測試（例：`src/__tests__/layer-dependencies.spec.ts`），也得先有 Docker，並等 container 啟動與 migration 跑完。
- 140 個單元測試檔逐一執行，沒有並行，拉長 `pnpm test` 與 CI 的時間。
- 沒有錯誤的結果，屬於開發體驗。

## 修正方式

用 vitest 的 `test.projects` 拆成兩個 project：

1. `unit`：
   - 收 `src/**/*.spec.ts`，排除 `src/db/seeds/__tests__/seed.spec.ts`（或把它搬到 `test/`）。
   - 不掛 `globalSetup`、`setupFiles`，允許檔案並行。
2. `integration`：
   - 收 `test/**/*.spec.ts` 與 seed 的測試。
   - 保留 `globalSetup`、`setupFiles` 與 `fileParallelism: false`。
3. `package.json` 的 `test` 照舊兩個都跑；另加 `test:unit` 給只想跑單元測試的人。[`conventions/04-testing.md`](../conventions/04-testing.md) 的指令說明一起更新。

## 驗證方式

- 在沒有 Docker 的環境，`pnpm --filter @b2b-system/api exec vitest run --project unit` 全部通過。
- `pnpm --filter @b2b-system/api test` 的結果與拆分前相同，總時間縮短。
