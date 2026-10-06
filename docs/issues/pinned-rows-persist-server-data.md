# 表格的釘選列把整筆伺服器資料長期存在 localStorage，登出也不清

## 現況

`packages/web-core/src/store/tableColumnSettings.ts`：

- `PinnedRow`（L49–53）存整筆資料：`{ id, side, row: unknown }`。
  L46 的註解寫明「保留整筆資料，換到別頁時仍能顯示」。
- `pinRow()`（L109–112）把整列寫進 `writePinnedRows()`（L124–127），存到 localStorage 的 `b2b-system:table-column-settings`（L71 `createDictStorage('table-column-settings')`、L59 `pinnedRows`）。
- 只有使用者自己取消釘選，或在偏好頁按「清除」（`clearPinnedRows()`，L118–121）才會刪掉。

session 結束時不會清：

- `apps/backstage/src/app/App.tsx` 的 `SessionWatcher`（L44–54）在 `ended` 時只清權限 store 與 `queryClient`。
- `apps/platform/src/app/App.tsx` 的 `SessionWatcher`（L42–50）相同。

啟用釘選（有 `settings.tableId` 與 `getRowId`）的表：

- backstage：使用者、角色、審批、稽核紀錄列表。
- apps/platform：稽核紀錄、feature flag、平台管理者、租戶列表。

兩份文件的規定互相矛盾：

- [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.1（L955、L975–977）明寫釘選「存的是整筆資料，重新整理後仍在，但內容可能是舊的」。
- [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2（L176–178）把「任何個人識別資訊」「任何伺服器資料的複本」列為不可放進 localStorage。
- 09 §3.3 也要求登出時清掉快取，「否則下一個在同一個分頁登入的人會先看到上一個人的快取資料」。釘選列繞過了這條規則。

重現：

1. A 在使用者列表釘選幾列（含 email、狀態、角色），然後登出。
2. B 在同一個瀏覽器登入同一個租戶，打開使用者列表。
3. B 看到 A 釘選的列，內容是 A 釘選當下的資料。

## 影響

- 共用電腦或交接裝置時，上一個人看過的個人資料（email、名稱、角色、稽核紀錄的內容）留在 localStorage，不會過期。
  apps/platform 的平台管理者與租戶資料也一樣。
- 下一個使用者在同一張表上，看到不是自己釘選、而且可能已經過期的列（例如已停用的帳號仍顯示為啟用）。
- 上面列出的表都不做逐列授權：能進頁面就看得到所有列。所以目前不會看到「本來沒有權限看」的列。
  之後若有表格依資料層級的權限過濾、又開了釘選，就會變成外洩。
- XSS 時，這些資料可以直接從 localStorage 讀走（09 §4.2 禁止的理由）。

## 修正方式

擇一，建議 1：

1. 只存 `{ id, side }`：
   - 不在目前這一頁的釘選列，改用一筆查詢依 id 取最新的資料，或顯示「在其他頁」的佔位。
   - 同時修正 07 §6.1 的說明。
2. 保留整筆資料，但不落地：
   - 改存記憶體或 sessionStorage。
   - 並在 `sessionStore` 的 `ended` 時清掉，可以放在 web-core，兩個 app 都受惠。
   - 同時修正 09 §4.2，寫明例外與清除時機。

不論哪個方案，`SessionWatcher` 的清除清單都要涵蓋「任何以使用者身分取得的資料」，不能只清 `queryClient`。

## 驗證方式

- `packages/web-core/src/store/__tests__/tableColumnSettings.test.ts` 補測試：
  - 方案 1：`pinRow()` 之後 localStorage 的值不含 `row`。
  - 方案 2：`sessionStore.endSession()` 之後 `getState().pinnedRows` 為空，localStorage 也沒有。
- E2E（選做）：A 釘選後登出，B 登入同一張表，看不到 A 的釘選列。
