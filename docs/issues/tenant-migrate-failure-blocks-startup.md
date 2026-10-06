# 一個租戶的 migration 或 seed 失敗，api 與對外 API 就不會啟動

## 現況

`apps/api/src/db/migrate.ts` 的 `main()`（L20–65）：

- L49 `for (const tenant of await listScriptTenants(platform.db))` 沒有帶 `activeOnly`。
  `listScriptTenants()`（`client.ts` L62–91）只排除已刪除的租戶，所以 `provisioning`、`failed`、`disabled` 都會跑。
- 每個租戶先跑 `ensureDatabase()`（`client.ts` L128–156）。只有「database 不存在」（`3D000`）才會嘗試建立；其他連線錯誤直接拋出，例如 DB 角色不存在造成的認證失敗。
- 失敗的租戶收集起來，L61 `if (failed.length) throw …`，接著 L67–70 `process.exit(1)`。

seed 也一樣：`seeds/index.ts` 的 `main()`（L191–205）用 `forEachScriptTenant()`（`client.ts` L97–117），迴圈裡沒有 try/catch。第一個失敗的租戶會中止後面所有租戶，並以 exit 1 結束。

`docker-compose.prod.yml` 把這兩步串起來，並讓 api 等它們成功：

```yaml
command: ['sh', '-c', 'node dist/src/db/migrate.js && node dist/src/db/seeds/index.js']   # L75
…
depends_on:
  migrate:
    condition: service_completed_successfully   # api L151–153、external-api L186–188
```

佈建（`tenant.provision`）與「佈建中斷」的清掃（`tenant.provisionSweep`）都是 api 程序裡的背景工作（`tenant-provisioner.ts` 的 `onModuleInit()`，L81–88）。

會讓 migrate 失敗的狀態：

1. `failed` 的租戶在佈建第 ① 步（`ensureTenantDatabase()`）就失敗，DB 角色與 database 都不存在。
2. 部署時有 `provisioning` 的租戶，佈建工作還沒跑，同上。
3. 某個租戶的 DB 暫時連不上，或被搬到別的叢集。

文件之間也不一致：

- [`05-tenancy.md`](../architecture/05-tenancy.md) §4（L73）、§8 與程式相同，跑「每個未刪除的租戶」。
- §10.2 D14（L350）與 [`backend/02-database.md`](../architecture/backend/02-database.md) §5.3（L679）寫的是「每個 active 租戶」。

## 影響

- 一個租戶有問題，所有租戶一起停擺，新版本的 api 與 external-api 都不會啟動。
  依 compose v2 的行為，`up` 會先以新映像重建容器，再依 `depends_on` 啟動，所以部署當下舊的 api 已經被換掉。`down` 之後再 `up` 也一樣起不來。
- 這與 D14 相反。D14 要求「一個租戶壞掉不該讓所有租戶停擺；落後的租戶回 503，不阻止整個程序啟動」。
  api 本來就會讓落後的租戶回 `503 TENANT_UNAVAILABLE`（02-database.md §5.3），不需要 migrate 擋住整個程序。
- 情況 2 會形成死結：
  - 佈建在 api 裡跑，api 起不來，佈建就永遠不會完成。
  - 清掃會把它改成 `failed`，但清掃也在 api 裡；而且 `failed` 一樣會讓 migrate 失敗。
  - 平台管理頁的刪除、重試佈建也跟著不能用，只能手動改平台 DB。
- 刪除預設租戶之後，還有另一個會讓 migrate 失敗的情況，見 [`deleted-default-tenant-reregistered.md`](./deleted-default-tenant-reregistered.md)。

## 修正方式

1. `migrate.ts`：
   - 跳過 `provisioning` 與 `failed` 的租戶（由佈建與「重試佈建」負責它們的 migration），只記一行 info。
   - 其他租戶失敗時照樣逐一列出、寫 error log。只有 **平台 DB** 的 migration 失敗才以非零結束。
     也可以加一個 `--strict` 旗標給 CI 用，部署時不加。
   - 把 `main()` 拆成可以匯出的函式（例：`migrateAll()`）。`seeds/index.ts` 已經用 `require.main === module` 的寫法，照做才能寫測試。
2. `seeds/index.ts`：每個租戶各自 try/catch。失敗的租戶列出來，不中止其他租戶；結束碼規則同上。
3. compose（擇一，建議 a）：
   - a. 維持一個 `migrate` 服務，採用上面的結束碼規則。
   - b. 拆成兩個服務：`migrate-platform`（api 以 `service_completed_successfully` 依賴它）與 `migrate-tenants`（api 不依賴）。
4. 文件：D14 與 02-database.md §5.3 改成「每個未刪除、而且不是佈建中或佈建失敗的租戶」，並寫明結束碼的規則。

## 驗證方式

- 新增整合測試（`apps/api/test/`，例如 `db-scripts.spec.ts`）。在平台 DB 登記一個 `failed` 租戶（連線字串指向不存在的角色）與一個 `provisioning` 租戶，再跑 `migrateAll()` 與 seed：
  - 回傳值或結束碼表示成功；
  - 其他租戶照常 migrate，也補上權限目錄；
  - log 列出被略過的租戶。
- 另一個案例：讓一個 `active` 租戶的 DB 連不上。其他租戶照常完成；結果回報那個租戶失敗，但在非 strict 模式下不以非零結束。
- 部署驗證：以假值起 prod compose，手動登記一個沒有 DB 的 `failed` 租戶，再執行一次 `up`，api 仍然變成 healthy。
