# 租戶登記、系統設定、事件政策的快取沒有防載入期間的失效，舊值可能被寫回並活到 TTL

## 現況

`apps/api/src/core/cache/invalidation-tracker.ts` 開頭（L1–9）的註解描述了這個競態：載入時讀到交易提交前的舊資料，卻在 `invalidate()` 之後才 `set()`，舊值就會寫回快取並活到 TTL。它的解法是「載入前先取票，寫入前檢查有沒有被失效過」。

已經有防護的快取：

- 權限、使用者、API token 的快取用這個票（例：`modules/permission/permission.service.ts` L78、`common/auth/access-token.verifier.ts` L125、`modules/api-token/api-token.verifier.ts` L84）。
- 資料夾樹（`modules/file/file-folder-tree.ts` 的 `nodes()`，L59 起）快取進行中的 promise，失效時連它一起丟掉。

下面三個每租戶快取兩者都沒有，都是「await 查 DB → 直接寫入快取」：

| 快取 | 載入 | 失效 | TTL |
| --- | --- | --- | --- |
| 租戶登記 `core/tenant/tenant-directory.service.ts` | `resolveHost()`（L161–176）、`findById()`（L178–183）、`findByCode()`（L151–158），都經 `remember()`（L239–246）寫入 | `invalidate()` → `clear()`（L194–204） | `TENANT_CACHE_TTL`，預設 30 秒 |
| 系統設定 `core/settings/setting.service.ts` | `stored()`（L102–115） | `invalidate()`（L143–147） | 30 秒（L28） |
| 事件政策 `modules/notification/notification-policy.service.ts` | `stored()`（L226–243） | `invalidate()`（L218–222） | 30 秒 |

```ts
// core/settings/setting.service.ts L107–113
const rows = new Map<string, StoredSetting>(
  (await this.repo.listAll()).map((row) => [row.key, { value: row.value, updatedAt: row.updatedAt }]),
);
this.cache.set(key, { rows, expiresAt: Date.now() + TTL_MS });
```

重現（以停用租戶為例）：

1. 租戶 T 的某個 Host 在本程序的 `byHost` 快取剛好過期。一個請求進入 `resolveHost()`，在 `findByDomains()`（L171）讀到 T 還是 `active`。
2. 平台管理者停用 T：`PlatformTenantService.disable()`（`modules/tenant/platform-tenant.service.ts` L321–333）提交 `status = 'disabled'`，接著呼叫 `directory.invalidate()` 清空快取。
3. 第 1 步的查詢這時才回來，`remember()` 把 `active` 的紀錄寫回 `byHost`。
4. 接下來最多 30 秒，本程序仍把 T 當成 `active`：
   - `Tenancy.enter()`（`core/tenant/tenancy.service.ts` L91–95）放行。
   - 持有未過期 access token 的人照常呼叫 API。
   - `endEverything()` 關掉的連線池被重建。

系統設定與事件政策也是同樣的順序。`SystemSettingService.update()`（`modules/system/system-setting.service.ts` L112–120）與 `NotificationPolicyService.update()`（L206–214）在失效之後回傳 `this.list()`；第 3 步剛好發生的話，連這個回應都會是舊值。

## 影響

- 正式文件寫的「本程序立即生效」不成立：
  - 停用租戶後網域回 503（[`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D13）。
  - 關閉 feature 或 flag（`platform-tenant.service.ts` L274 的註解）。
  - 系統設定與事件政策（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §1）。
- 前提：快取未命中的讀取，剛好跨過寫入的提交。一次查詢只要幾毫秒，所以機率低。最長延遲一個 TTL（30 秒），之後自動恢復。
- 停用租戶是安全動作，這 30 秒內已登入的人還能繼續使用。

## 修正方式

擇一（建議 1）：

1. 在 `core/cache` 抽出共用的「每租戶快取」，包含 TTL、快取進行中的 promise（失效時連同進行中的一起丟，做法同 `FileFolderTree.nodes()`）、廣播頻道。
   - `SettingService`、`NotificationPolicyService`、`FileFolderTree` 改用它。
   - `TenantDirectory` 的三個 `BoundedCache` 也改成快取 promise。
2. 最小修法：三者各自用 `InvalidationTracker`。它現在沒有從 `core/cache/index.ts` 匯出，要先匯出。
   - 載入前取票。
   - `remember()`／`cache.set()` 之前以 `isFresh()` 檢查。
   - `invalidate()` 時遞增世代，以租戶為一組。

## 驗證方式

在下面三個測試檔各補一個案例，步驟相同：

1. 讓 repo 回傳一個可以延後 resolve 的 promise。
2. 呼叫載入。
3. 呼叫 `invalidate()`。
4. resolve 舊資料。
5. 斷言下一次讀取會重新查 DB，而不是拿到舊值。

- `core/settings/__tests__/setting.service.spec.ts`
- `modules/notification/__tests__/notification-policy.service.spec.ts`
- `core/tenant/__tests__/tenant-directory.service.spec.ts`（`resolveHost`、`findById` 各一個）
