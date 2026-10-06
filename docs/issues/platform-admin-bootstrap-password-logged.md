# 第一位平台管理者的密碼在 production 以明文寫進 migrate 日誌，帳號直接啟用

## 現況

`apps/api/src/db/seeds/platform-admin.ts` 的 `seedPlatformAdmin()`（L14–41）：

```ts
const provided = process.env.PLATFORM_ADMIN_PASSWORD;
const password = provided && provided.length >= 12 ? provided : generateStrongPassword(24);
await upsertPlatformAdmin(db, { email, displayName: 'Platform Admin', password });
…
if (provided) console.info(`平台管理者已建立：${email}`);
else console.warn(`\n=== 初始平台管理者 ===\n  帳號：${email}\n  密碼：${password}\n`);
```

- 帳號是 `active`、角色是 super-admin（`upsertPlatformAdmin()`，L44–59；狀態用 `platform-admins.ts` L46 的欄位預設值）。
- prod compose 的 migrate 每次部署都會跑 seed（`docker-compose.prod.yml` L75），`PLATFORM_ADMIN_PASSWORD` 預設是空字串（L71）。
  所以照預設流程部署，密碼就會印在 migrate 容器的輸出裡。
- 租戶的 super-admin 有對應的保護，平台管理者沒有：
  - `super-admin.ts` L43–44：production 用隨機密碼時建成 `pending`，必須走啟用信。
  - [`rbac/05-seed-and-bootstrap.md`](../rbac/05-seed-and-bootstrap.md) §5.1（L245）把這一條列為安全要求。
- 另外還有兩個問題：
  - 提供的密碼不足 12 字元時，會被靜默換成隨機密碼。因為 `provided` 有值，這組密碼 **不會印出**。`super-admin.ts` L41、L71–78 也是同樣的寫法。
  - 兩支 seed 都直接呼叫 `hashPassword()`，不套用登入時的密碼政策（常見密碼等長度以外的規則）。
- 平台管理者沒有自助的忘記密碼流程（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.6，L434）。文件寫的重設 CLI 不存在，見 [`backend-architecture-docs-drift.md`](./backend-architecture-docs-drift.md)。

## 影響

- 看得到 migrate 容器日誌的人，都能以平台 super-admin 登入。日誌可能在主機上的 `docker logs`、集中式日誌，或日誌的備份裡。
- 這組密碼不會過期，也沒有強制變更。Docker 預設的 json-file 日誌不會輪替，所以會一直留著（見 [`no-backup-or-log-rotation.md`](./no-backup-or-log-rotation.md)）。
- 如果 `PLATFORM_ADMIN_PASSWORD` 不足 12 字元：帳號建立了，卻沒有人知道密碼；平台又沒有自助重設，只能手動改 DB。
- 受影響的是全平台權限最高的帳號。觸發的前提只是「照預設的 compose 部署、沒有設 `PLATFORM_ADMIN_PASSWORD`」。

## 修正方式

1. production（`NODE_ENV=production`）時，第一位平台管理者建成 `pending`，不印密碼，改印一次性、短效的設定連結：
   - 沿用 `platform_auth_tokens` 與 apps/platform 的 `/setup`。`platform-account-mail.jobs.ts` 已經用這種方式組平台管理者的設定連結。
   - 連結用過或過期就失效。
2. 提供的密碼不足 12 字元或不符密碼政策時，直接失敗（exit 1），不要靜默換成隨機密碼。租戶 super-admin 的 seed 也一樣處理。
3. 開發環境維持現在的行為（印出隨機密碼），方便本機使用。
4. 更新 rbac/05-seed-and-bootstrap.md §5.1，把平台管理者也列進「production 強制變更」。

## 驗證方式

- 在 `apps/api/src/db/seeds/__tests__/` 補案例（或寫成整合測試）：
  - `NODE_ENV=production`、沒有設 `PLATFORM_ADMIN_PASSWORD`：輸出不含密碼、帳號是 `pending`，印出的連結能完成設定。
  - `PLATFORM_ADMIN_PASSWORD` 只有 8 字元：拋錯，而且沒有建立帳號。
- 以假值起 prod compose，`docker compose logs migrate` 裡看不到任何密碼。
