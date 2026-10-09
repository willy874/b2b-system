# 前端 13 — 回收桶

> 狀態：**已實作**（`features/trash`，路由 `/trash`；「使用者」（R2）、「角色」（R3）、「檔案」與「資料夾」（R4）四類）。後端的回收桶、還原與永久刪除見
> [`../backend/13-trash.md`](../backend/13-trash.md)；決策見 [`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D9、D10。

平台可對租戶關閉回收桶（feature `trash`，[`architecture/05-tenancy.md`](../05-tenancy.md) §12.2 D3）：`features/trash` 是可啟用的 feature，
關閉時沒有回收桶頁；各資源刪除成功的提示以 `useIsFeatureReady(TenantFeature.trash)` 判斷，關閉時不附「復原」。

## 1. 組成

```
core/trash/                        註冊表（不認識任何 feature）
├── registry.ts                    registerTrashType()、trashLocaleLoader()
└── hooks.ts                       useTrashTypes()：訂閱註冊表

features/trash/                    回收桶頁：只讀註冊表，不 import 業務 feature
├── permission.ts                  TRASH_PAGE（任一種 <resource>:delete）
├── hooks/useTrashPermission.ts    看得到的類型（各自的權限）
└── pages/TrashList/               分頁（類型）＋ 表格 ＋ 換頁

features/user/trash.ts             登記「使用者」類型（plugin 的同步階段）
features/user/components/UserRestoreAction.tsx
features/role/trash.ts             登記「角色」類型
features/role/components/RoleRestoreAction.tsx
features/group/trash.ts            登記「群組」類型
features/group/components/GroupRestoreAction.tsx
features/file/trash.ts             登記「檔案」「資料夾」兩類（可在執行期停用的 feature：卸載時分頁跟著消失）
features/file/components/FileRestoreAction.tsx、FolderRestoreAction.tsx
features/announcement/trash.ts     登記「公告」類型（可在執行期停用的 feature；docs/architecture/frontend/16-announcement.md）
features/announcement/components/AnnouncementRestoreAction.tsx
features/gallery/trash.ts          登記「圖片庫」「相簿」兩類（可在執行期停用的 feature；docs/architecture/frontend/24-gallery.md）
features/gallery/components/GalleryRestoreActions.tsx
features/role/components/RoleRestoreAction.tsx
apis/trash/get-trash-list/         GET /trash
apis/user/restore-user/            POST /users/:id/restore
apis/role/restore-role/            POST /roles/:id/restore
apis/file/restore-file/            POST /files/:id/restore
apis/file/restore-file-folder/     POST /file-folders/:id/restore
apis/gallery/restore-gallery-item/  POST /gallery/items/:id/restore
apis/gallery/restore-gallery-album/ POST /gallery/albums/:id/restore
```

與後端對稱：後端的 `modules/trash` 以 `TrashRegistry` 收各模組的 handler、還原端點在擁有者；
前端的 `features/trash` 以 `core/trash` 的註冊表收各 feature 的類型、還原操作由擁有者的元件提供。
拿掉 `main.tsx` 的 `.use(trashFeaturePlugin())`，回收桶頁與選單消失；拿掉某個 feature，它的分頁消失。

## 2. 註冊表：`registerTrashType()`

在 feature plugin 的 **同步** 階段登記（[`02-plugin-system.md`](./02-plugin-system.md) §3.1、§6 的註冊表規則：
重複登記丟例外、可撤回、讀取端訂閱）。

| 欄位 | 說明 |
| --- | --- |
| `type` | 後端 `GET /trash?type=` 的值（`TrashResourceType`，由 SDK 產生）；也是分頁與網址 `?type=` 的鍵 |
| `order` | 分頁順序 |
| `labelI18nKey` | 分頁標題；放 **全域** 語系包（使用者用 `menu.user`、角色用 `menu.role`、群組用 `menu.userGroup`、檔案用 `menu.file`、資料夾用 `menu.fileFolder`） |
| `permission` | 看這一類與還原的權限：`<resource>:delete`，與後端 handler 的 `permission` 相同 |
| `localeScope` | 還原操作用到的 scope；回收桶的 route loader（`trashLocaleLoader`）一併載入 |
| `RestoreAction` | 每一列的還原操作元件（`{ item: TrashItem }`）：呼叫擁有者的還原 API、自己呈現錯誤 |

列表的欄位是共用的（名稱與描述、刪除時間、刪除者、預計永久刪除），由回收桶頁渲染；類型特有的只有還原操作。
後端 `TrashItem` 的形狀本來就是各類型共用的，所以不需要各類型提供欄位定義。

## 3. 權限

| 層 | 規則 |
| --- | --- |
| 頁面（`TRASH_PAGE`） | `match: SOME` 的 `TRASH_PAGE_PERMISSIONS`（`[user:delete, role:delete, group:delete, file:delete, announcement:delete]`）：至少能刪一種才進得去、選單才出現。與後端 `TRASH_PERMISSIONS` 是同一組鍵，新類型兩邊一起加 |
| 分頁 | `useTrashPermission()`：登記的類型中 `can(type.permission)` 的那些；未水合時為空（不閃現） |
| 網址 `?type=` | 不存在或看不到時改看第一個看得到的分頁 |
| 後端 | 仍會以該類型的權限再檢查一次（[`../backend/13-trash.md`](../backend/13-trash.md) §3） |

側邊選單在「系統管理」分類，項目 `menu.trash`（`testId: menu-trash`）。

## 4. 使用者的還原

- `useUserRestoreMutation()`（`features/user/hooks/useUserMutations.ts`）：成功時以 `user` / `create` 宣告
  （使用者重新出現在列表；`apis/resources.ts` 的 `TRASH` 由 `user` 的 `create`／`delete` 衍生而失效），提示「已還原」。
- `409 USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE` 帶 `details.conflictingUserId`：錯誤提示附「查看該帳號」，
  按下導向那個使用者的詳情（email 不能改，管理者要先處理佔用的帳號）。其他錯誤照一般的錯誤提示。
- **刪除後的「復原」**：`useUserDeleteMutation()` 成功的提示附「復原」動作鈕（`Toast` 的 `action`），按下呼叫同一個還原端點。
  刪除與還原都要 `user:delete`，刪得掉的人一定按得了。批次刪除不提供復原（到回收桶還原）。

## 4.1 角色的還原

- `useRoleRestoreMutation()`（`features/role/hooks/useRoleMutations.ts`）：成功時以 `role` / `create`（重新出現在列表、回收桶失效）與
  `role` / `update`（使用者列表的角色摘要）宣告；提示「已還原」，有持有者一併恢復時帶人數（回應的 `holdersRestored`）。
  自己的 profile 不必重抓：反提權保證角色的鍵自己都已持有。其他持有者由伺服器推 `userRole` / `update`（他們的 profile 跟著失效）。
- `409 ROLE_NAME_DUPLICATE` 帶 `details.conflictingRoleId`：錯誤提示附「查看該角色」，導向佔用的角色（先改名或刪除它）。
- `403 AUTHZ_ESCALATION`：提示「這個角色帶有你未持有的權限，無法還原」，不用通用的「不能授予自己未持有的權限」。
- **刪除後的「復原」**：`useRoleDeleteMutation()` 成功的提示附「復原」，按下呼叫同一個還原端點；刪除與還原都要 `role:delete`。
  刪除的確認文字改成「移到回收桶，保留期限內可以還原」。

## 4.2 檔案與資料夾的還原

- 分頁「檔案」（`file`）與「資料夾」（`fileFolder`）都要 **全域** `file:delete`（後端 13-trash §7.4）。列的說明（`description`）是原本所在的路徑（`/素材/ui`）。
  「資料夾」分頁只列每一次刪除的根；跟著資料夾一起刪的檔案不在「檔案」分頁，還原資料夾時一起回來。
- `useFileRestoreMutation()`（`features/file/hooks/useFileMutations.ts`）：成功時以 `file` / `create` 宣告（列表重抓、回收桶失效）。
  `409 FILE_RESTORE_CONFLICT` 依 `details.reason` 說明：`parentDeleted` → 先到「資料夾」分頁還原資料夾；`objectMissing` → 內容已不存在、無法還原。
- `useFolderRestoreMutation()`（`useFolderMutations.ts`）：成功時以 `fileFolder` / `create` 與 `file` / `create`（`id='*'`）宣告；
  回應的 `filesSkipped` > 0 時以警告提示「其中 n 個檔案的內容已不存在」。`409 FILE_FOLDER_NAME_CONFLICT` → 「先把同名的資料夾改名或移走」；
  `409 FILE_FOLDER_RESTORE_CONFLICT`（上層已刪除）用通用訊息。
- **刪除後的「復原」**：刪除檔案的提示附「復原」（還原那個檔案）、刪除資料夾的提示附「復原」（還原整批）；
  確認文字（單筆、多選、含資料夾的多選）都說「移到回收桶，保留期限內可以還原」。後端刪除檔案時保留物件（R4b，後端 13-trash §7.5），
  所以剛刪的檔案一定救得回來。
- 只有資料夾授權的人（`file:access`）看不到回收桶，但能以「復原」還原自己剛刪的資料夾（還原端點的權限與刪除相同）。

## 5. 系統設定

保留天數 `trash.retentionDays` 在系統設定頁的「回收桶」分類（`features/system/constants.ts`，單位「天」）；
列表的「預計永久刪除」依目前的值計算（後端回傳 `purgeAt`）。

## 6. 測試

| 對象 | 檔案 |
| --- | --- |
| 註冊表：排序、重複登記、反註冊 | `core/trash/__tests__/registry.test.ts` |
| 權限 facade：依權限過濾、未水合 | `features/trash/hooks/__tests__/useTrashPermission.test.tsx` |
| 頁面：三個權限案例、網址的類型看不到時的退回、還原操作收到列 | `features/trash/pages/TrashList/__tests__/TrashListPage.test.tsx` |
| adapter | `features/trash/pages/TrashList/__tests__/adapter.test.ts` |
| 使用者的還原、409 的「查看該帳號」、刪除提示的「復原」 | `features/user/components/__tests__/UserRestoreAction.test.tsx` |
| 角色的還原（持有者人數）、409 的「查看該角色」、反提權的說明、刪除提示的「復原」 | `features/role/components/__tests__/RoleRestoreAction.test.tsx` |
| 頁面：只有 `role:delete` 也進得去、只看到角色分頁 | `features/trash/pages/TrashList/__tests__/TrashListPage.test.tsx` |
| 檔案與資料夾的還原、`parentDeleted`／`objectMissing` 的說明、`filesSkipped` 的提示、同名的說明、檔案與資料夾刪除提示的「復原」 | `features/file/components/__tests__/FileRestoreAction.test.tsx` |
| 頁面：只有 `file:delete` 也進得去、只看到檔案分頁 | `features/trash/pages/TrashList/__tests__/TrashListPage.test.tsx` |
| 依賴圖：`user`、`role`、`file`、`fileFolder` 的 create／delete 讓回收桶失效 | `apis/__tests__/resources.test.ts` |
