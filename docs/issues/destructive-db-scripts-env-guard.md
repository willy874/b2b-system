# 會清資料的 DB 腳本只看執行者的 `NODE_ENV`，`pnpm test:e2e` 也會自動清空 `.env` 指向的資料庫

## 現況

`apps/api/src/db/reset.ts` 的 `main()`（L9–26）：

```ts
if (process.env.NODE_ENV === 'production') {
  throw new Error('db:reset 不可在 production 執行');
}
…
sql`TRUNCATE users, roles, groups, permissions, relation_tuples, … RESTART IDENTITY CASCADE`
```

- 平台 DB 清掉協定狀態與 session（L15–17），每個租戶的業務表全部 TRUNCATE（L20–24）。
- `seeds/dev.ts` 的 `seedDevData()`（L139–141）與 `seeds/e2e.ts` 的 `seedE2eData()`（L48–50）同樣只看 `NODE_ENV`。
  e2e 的檢查放錯位置，另見 [`e2e-seed-creates-platform-admin-before-guard.md`](./e2e-seed-creates-platform-admin-before-guard.md)。
- 這個 `NODE_ENV` 是「執行腳本的 shell」的值。`loadScriptEnv()`（`client.ts` L21–24）會讀 repo 的 `.env`，裡面是 `development`。
  腳本完全不看目標 DB 是哪一個、是不是 production。

E2E 會自動清資料庫：

- `apps/e2e/global-setup.ts`（L10–21）每次跑 E2E 都會依序執行 `db:reset`、`db:seed`、`db:seed:e2e`，只有設 `E2E_SKIP_SEED=1` 才跳過。
- [`05-tenancy.md`](../architecture/05-tenancy.md) §9（L295）提醒「跑之前一定要帶暫用 DB…否則會清空共用的開發資料庫」，但程式沒有擋。
- [README](../../README.md) 的「測試」段落（L124–137）沒有任何提醒。

## 影響

- 在開發機的 shell（`NODE_ENV=development`）帶著 production 的 `PLATFORM_DATABASE_URL` 與 `TENANT_SECRET_KEY` 執行 `pnpm db:reset` 或 `pnpm test:e2e`：
  每個租戶的使用者、角色、檔案紀錄、稽核都會被 TRUNCATE CASCADE，無法復原。
  例如排查問題時開了 tunnel，或臨時改了 `.env`。
- 沒帶暫用 DB 就跑 `pnpm test:e2e`，會清空共用的開發資料庫。文件有提醒，但只靠人記得。
- 觸發的前提是人為失誤；但一旦發生，影響跨所有租戶。

## 修正方式

改成檢查「目標 DB」。以下可以擇一或併用，建議 1＋2：

1. 在平台 DB 存一個環境標記，例如新增一張只有一列的設定表，`environment = 'production'` 由 production 的 migrate 寫入。
   `reset`、`seed:dev`、`seed:e2e` 開頭讀到 production 就拒絕執行。
2. 只允許本機的 DB：host 是 `localhost`、`127.0.0.1`，或 compose 開發用的 `postgres`。其他 host 必須加 `--confirm <database 名稱>` 才執行。
3. E2E 的 global-setup：沒有明確指定 E2E 用的 DB 就拒絕 reset，並提示 [`frontend/10-testing.md`](../architecture/frontend/10-testing.md) §4.3 的作法。
   「明確指定」可以是設了 `E2E_DATABASE_URL`，或 `PLATFORM_DATABASE_URL` 與 `.env` 裡的值不同。
4. README 的 E2E 段落補一句：「會清空 `.env` 指向的資料庫」。

## 驗證方式

- 腳本的單元測試或整合測試：
  - 目標 DB 有 production 標記時，`reset`、`seed:dev`、`seed:e2e` 在任何寫入之前就拋錯。
  - 目標 host 不是本機、又沒有 `--confirm` 時，拋錯。
- 手動驗證：不帶暫用 DB 執行 `pnpm test:e2e`，global-setup 要立刻失敗並說明原因，開發 DB 的資料不變。
