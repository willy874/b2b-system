# E2E 在 api 跑著時重灌資料庫，api 啟動時的準備不會補上

## 現況

`apps/e2e/global-setup.ts` 在 api 已經啟動之後執行 `db:reset`、`db:seed`、`db:seed:e2e`。
這些腳本直接寫資料庫，不經過 api，所以 api 只在啟動或收到領域事件時才做的準備不會發生。已確認的一項：

- 系統資料夾（共用資料夾、私人資料夾）與每個人的個人資料夾由 `FileSystemFolderService`
  （`apps/api/src/modules/file/file-system-folder.service.ts`）在 `onApplicationBootstrap` → `prepareTenant()`、
  以及 `permissions.changed`（只補事件帶的 `userIds`）時建立。重灌後的資料庫裡沒有這些資料夾，
  種子帳號的 `GET /file-folders` 回 `personalFolderId: null`，直到某個測試剛好改了那個人的角色才補上。

2026-10-06 的 `file.spec.ts` 原本在個人資料夾裡建子資料夾，在乾淨的資料庫上以 403 失敗、單獨重跑卻會過（前一次執行已經補上），
後來改成由 admin 在根目錄建資料夾來避開。

## 影響

- E2E 不能測「打開檔案管理就落在個人資料夾」與系統資料夾的行為；這類案例會依執行順序時過時不過。
- 其他在啟動時預熱、之後只靠事件失效的程序內狀態，重灌後也可能殘留上一次的值（尚未逐一確認）。

## 修正方式

擇一：

1. global-setup 重灌後重啟 api（Playwright 的 `webServer` 改成也起 api，或在 setup 裡 kill／重起），最貼近正式環境的順序。
2. 新增腳本（例：`db:prepare-tenants`），以 `NestFactory.createApplicationContext` 起一個不聽埠的 app，
   對每個租戶呼叫 `FileSystemFolderService.prepareTenant()`；`db:seed:e2e` 最後執行它。
3. `db:seed:e2e` 結束時經 `core/broadcast` 送出整個租戶的 `permissions.changed`，讓跑著的 api 補建
   （要先讓 `ensurePersonalFolders` 在沒有 `userIds` 時處理全部的人）。

## 驗證方式

在已經啟動的 api 旁執行 global-setup 的三個指令，接著以 `e2e-member@dev.local` 打 `GET /api/file-folders`，
`personalFolderId` 不是 null；再把 `file.spec.ts` 的上傳案例改回以 member 上傳到自己的個人資料夾，在乾淨的資料庫上跑過。
