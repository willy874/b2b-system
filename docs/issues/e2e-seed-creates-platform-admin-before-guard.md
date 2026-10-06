# `db:seed:e2e` 在 production 檢查之前，就建立了已知密碼的平台 super-admin

## 現況

`apps/api/src/db/seeds/e2e.ts` 的 `main()`（L91–111）先寫入平台管理者，之後才進到有 production 檢查的 `seedE2eData()`：

```ts
await upsertPlatformAdmin(platform.db, {
  email: E2E_PLATFORM_ADMIN,          // e2e-platform@dev.local
  displayName: 'E2E Platform Admin',
  password: E2E_PASSWORD,
});
…
await forEachScriptTenant(async (db) => {
  await runSeed(db);
  await seedE2eData(db);              // production 檢查在這裡面
}, …);
```

- production 檢查是 `seedE2eData()` 的第一行（L47–50），比平台管理者的寫入晚。
- `upsertPlatformAdmin()`（`platform-admin.ts` L44–59）：
  - 沒指定角色時就是 `super-admin`（L50），帳號狀態是 `active`。
  - email 已存在時，會把密碼、角色改回來並解鎖（L54–58）。
- 密碼是 `E2E_PASSWORD`（`e2e.ts` L16），寫在公開 repo 的原始碼裡（GitHub 上的 repo 是 public）。
- 正式映像也帶著這支腳本：`dist/src/db/seeds/e2e.js`（見 [`docker-image-and-context-hygiene.md`](./docker-image-and-context-hygiene.md)）。

攻擊或誤操作的步驟：

1. 有人對 staging 或 production（`NODE_ENV=production`）執行 `pnpm db:seed:e2e`，或在容器裡執行 `node dist/src/db/seeds/e2e.js`。例如想在 staging 跑 E2E。
2. 平台 DB 先寫入 `e2e-platform@dev.local`：super-admin、active、密碼是公開的。
3. 接著 `seedE2eData()` 拋出「不可在 production 執行」。指令失敗，看起來像被擋下了。
4. 任何人都能用公開的帳密登入 apps/platform。

## 影響

- 平台 super-admin 能管理所有租戶：建立、停用、刪除、改網域、開關 feature 與 flag，也能管理其他平台管理者。
- 前提是有人對 production 等級的平台 DB 跑了 e2e seed。這正是那個檢查要擋的情況，但它擋在寫入之後。
- `runSeed(db)`（L106）也在檢查之前執行。它只做一般 `db:seed` 會做的事，不是問題。

## 修正方式

1. 把 production 檢查移到 `main()` 的第一行：放在 `loadScriptEnv()` 之後、建立任何連線之前。
   `seedE2eData()` 裡的檢查可以保留，當作第二道防線。
2. 更好的作法是檢查「目標 DB」，而不是執行者的 `NODE_ENV`（見 [`destructive-db-scripts-env-guard.md`](./destructive-db-scripts-env-guard.md)）。
3. 正式建置不要包含 `seeds/e2e.ts`、`seeds/dev.ts`、`reset.ts`（見 [`docker-image-and-context-hygiene.md`](./docker-image-and-context-hygiene.md)）。

## 驗證方式

- 把 `main()` 匯出（例如 `seedE2e()`），並在 `apps/api/test/` 新增整合測試：
  `NODE_ENV=production` 時呼叫它，要拋錯，而且平台 DB 的 `platform_admins` 裡沒有 `e2e-platform@dev.local`。
- 現有的 E2E 照常通過（`pnpm test:e2e` 的 global-setup 會跑 `db:seed:e2e`）。
