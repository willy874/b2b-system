# 刪除預設租戶後，每次部署的 migrate 都會重新登記它，導致部署失敗或已刪除的資料重新上線

## 現況

- `docker-compose.prod.yml` 的 migrate 一定會設 `DEFAULT_TENANT_DATABASE_URL`（L65）。bucket 預設是 `b2b-system`（L69）。
- `apps/api/src/db/migrate.ts` 的 `main()` 只要有 `DEFAULT_TENANT_DATABASE_URL`，就呼叫 `registerTenant()`（L32–46）。
  文件對「什麼時候登記」說法不一：
  - docstring（L17–18）與 [`05-tenancy.md`](../architecture/05-tenancy.md) §8（L279）寫「平台 DB 沒有租戶時才登記」。
  - [`backend/02-database.md`](../architecture/backend/02-database.md) §6.1（L752）寫「設定了就登記」。
- `apps/api/src/db/platform/register-tenant.ts` 的 `registerTenant()`（L22–70）只找「未刪除、代碼相同」的租戶（L30–34）。
  找不到就 INSERT（L36–48），狀態用欄位預設的 `active`（`tenants.ts` L37）。
- `apps/api/src/db/platform/schema/tenants.ts`（L84–85）的 bucket 唯一索引連已刪除的列也算：

  ```ts
  // 刪除的租戶也算：bucket 可能還沒清掉，不能讓新租戶沿用
  uniqueIndex('tenants_storage_bucket_key').on(t.storageBucket),
  ```

- 刪除：`apps/api/src/modules/tenant/platform-tenant.service.ts` 的 `remove()`（L355–385）沒有擋預設租戶。它標記刪除、釋出網域，database 與 bucket 都留著。
- 清除：`apps/api/src/db/drop-tenant.ts`（L25、L53–55）只處理佈建產生的 database 名稱（`tenant_` 開頭）。預設租戶的 database 不是這種名稱，所以這一列永遠清不掉。

重現：

1. 在 apps/platform 刪除預設租戶（`default`）。UI 沒有任何警告。
2. 下一次部署時，migrate 先跑完平台 DB，再呼叫 `registerTenant()`：
   1. 找不到未刪除的 `default`，於是 INSERT。
   2. 已刪除的那一列還佔著 bucket，INSERT 撞上 `tenants_storage_bucket_key`。
   3. 拋錯，exit 1。
3. api 與 external-api 不會啟動（原因同 [`tenant-migrate-failure-blocks-startup.md`](./tenant-migrate-failure-blocks-startup.md)）。

## 影響

- 刪除預設租戶之後，每一次部署都失敗。所有租戶一起停擺，直到有人手動改平台 DB 或 compose。
- 維運若改 `DEFAULT_TENANT_STORAGE_BUCKET` 來繞過，結果更糟：
  - 會登記一個新的 `active` 租戶，指向 **被刪掉的那個 database**。
  - 刪除時釋出的 `DEFAULT_TENANT_DOMAINS` 會被掛回去。
  - 被刪租戶的使用者可以用原本的密碼再登入，看到所有資料（檔案在舊 bucket，所以看不到）。
  - 等於刪除失效（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D13）。
- 代碼 `default` 若已經給了新客戶（刪除後代碼可以重用）：每次部署都會把 `DEFAULT_TENANT_DOMAINS` 裡沒被別人佔用的網域，加到這個新客戶身上。
- 觸發的前提是預設租戶在平台被刪除。這是 UI 允許、也沒有警告的操作。預設租戶本來是「還沒有租戶管理之前的唯一租戶」（D20），有了正式的租戶之後很可能被刪掉。

## 修正方式

1. `migrate.ts`（建議）：照 docstring 與 05-tenancy.md §8 的寫法，只在平台 DB **一個租戶都沒有**（含已刪除的）時登記預設租戶，之後的部署一律不再登記。
2. compose：不要寫死 `DEFAULT_TENANT_DATABASE_URL`，改成只在第一次部署時需要。例如寫成 `${DEFAULT_TENANT_DATABASE_URL:-}`，並在 README 說明只有第一次部署才設。
3. 平台刪除預設租戶時，至少警告「database 不會被清除」。
   或者讓 `db:drop-tenant` 也能處理 `db:migrate` 登記的租戶，並要求另一個明確的確認參數。
4. 文件：統一 05-tenancy.md §8、02-database.md §6.1 與 docstring 的說法。

## 驗證方式

- 新增整合測試（`apps/api/test/`，可以和 [`tenant-migrate-failure-blocks-startup.md`](./tenant-migrate-failure-blocks-startup.md) 的測試放在一起）：
  1. 跑一次 `migrateAll()`，登記預設租戶。
  2. 把它軟刪除（設定 `deleted_at`、移除網域）。
  3. 再跑兩次 `migrateAll()`。兩次都要成功結束、沒有新的 `default` 列，網域也沒有被掛回去。
- 另一個案例：代碼 `default` 已經屬於另一個新租戶時，`migrateAll()` 不能改動它的網域。
