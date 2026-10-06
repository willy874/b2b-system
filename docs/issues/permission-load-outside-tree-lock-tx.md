# 持有資料夾樹鎖的交易內另取連線載入權限，連線池滿時會卡到逾時

## 現況

資料夾結構的寫入先在交易內取整個租戶的資料夾樹鎖（`apps/api/src/modules/file/file-folder-tree.ts` 的 `write()`，L85–94），接著在同一個交易內建立存取判斷：

```ts
const result = await this.writeTree(async (tx) => {
  const ctx = await this.access.contextFor(actor, tx);   // file-folder.service.ts L321–322
```

- 呼叫點：
  - `apps/api/src/modules/file/file-folder.service.ts`：`create()`（L142–143）、`ensurePaths()`（L196–197）、`rename()`（L284–285）、`move()`（L321–322）、`remove()`（L403–404）、`restore()`（L472、L503）。
  - `apps/api/src/modules/file/file-folder-grant.service.ts`：`set()`（L61–62）、`revoke()`（L109–110）、`setInheritance()`（L142–143）。
- `apps/api/src/modules/file/file-access.service.ts` 的 `contextFor()`（L49–68）第一步是 `this.permissions.getPermissionSet(actor.id)`（L50），沒有 `tx` 可以傳。
- `apps/api/src/modules/permission/permission.service.ts` 的 `getPermissionSet()`（L73–83）在快取沒命中時，用注入的 `TENANT_DB` 從連線池另取一條連線來查。
  這時同一個交易已經佔著一條連線、持有樹鎖。
- 同樣在交易內另取連線的還有：
  - `apps/api/src/modules/role/role.service.ts` 的 `revertToRevision()`（L426 起）：交易內（L445 起）呼叫 `assertNoSelfLockout()`（L456–461），裡面不帶 `tx` 查 DB。
  - [`announcement-activation-resolves-audience.md`](./announcement-activation-resolves-audience.md) 的 `runEvent()`。

重現（三件事同時發生）：

1. `TENANT_POOL_MAX` 是預設的 10，有 9 個交易在等樹鎖、各佔一條連線。往資料夾上傳時，`insideFolder()`（`file-folder.service.ts` L111–121）也在交易內等這把鎖。
2. 持鎖的資料夾操作進到 `contextFor()` 時，操作者的權限快取剛好失效。guard 剛載入過，所以只有「這段期間租戶有權限變更」（`permissionsChanged()` 讓整個租戶失效）才會發生。
3. `getPermissionSet()` 要等一條連線。等鎖的 9 個在等持鎖的交易結束，持鎖的交易在等它們讓出連線。
   postgres.js 沒有取連線的逾時，只能等那些等鎖的語句撞上 `statement_timeout`（15 秒）被取消。

## 影響

- 條件湊齊時，那個租戶卡住約 15 秒。等樹鎖的請求回 500，其他請求也拿不到連線。
- 平常 guard 剛把權限載入快取，交易內幾乎都會命中，所以很少發生。上傳量大、同時又有管理者在改角色或群組時，機率會變高。
- 這是「交易內另取連線」這類寫法的通病：池子越小、鎖越熱，越容易遇到（[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2）。

## 修正方式

1. `contextFor()` 不在交易內從池子另取連線（擇一，建議 a）：
   - a. 呼叫端在 `writeTree()` 之前先取 `getPermissionSet()`，傳進 `contextFor()`。權限集合不在樹鎖保護的範圍內，提前讀與 guard 的判斷一致。
   - b. `getPermissionSet()` 加上可選的 `tx`，快取沒命中時用同一個交易查。
2. `revertToRevision()`：`assertNoSelfLockout()` 裡的讀取改成帶 `tx`。
3. 加一道防線：測試環境在交易進行中、同一個 async context 又從池子取 `TENANT_DB` 連線時直接拋錯，讓這類寫法在測試就被抓到。

## 驗證方式

- `apps/api/src/modules/file/__tests__/file-access.service.spec.ts`：帶 `tx` 建立判斷時，不會從 `TENANT_DB` 另取連線（假的 db 斷言沒被呼叫）。
- `apps/api/test/file-access.spec.ts` 補整合測試，把 `TENANT_POOL_MAX` 設成 2：
  1. 一個交易持有樹鎖。
  2. 讓整個租戶的權限失效。
  3. 同時送出一個往資料夾的上傳登記與一個建立資料夾。
  4. 兩個都在幾秒內完成，不會卡到 `statement_timeout`。
