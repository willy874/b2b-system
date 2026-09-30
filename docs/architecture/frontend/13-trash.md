# 前端 13 — 回收桶

> 狀態：**已實作**（`features/trash`，路由 `/trash`；「使用者」（R2）與「角色」（R3）兩類）。後端的回收桶、還原與永久刪除見
> [`../backend/13-trash.md`](../backend/13-trash.md)；決策見 [ADR-0025](../../adr/0025-entity-revisions.md) D9、D10。

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
apis/trash/get-trash-list/         GET /trash
apis/user/restore-user/            POST /users/:id/restore
apis/role/restore-role/            POST /roles/:id/restore
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
| `labelI18nKey` | 分頁標題；放 **全域** 語系包（使用者用 `menu.user`、角色用 `menu.role`） |
| `permission` | 看這一類與還原的權限：`<resource>:delete`，與後端 handler 的 `permission` 相同 |
| `localeScope` | 還原操作用到的 scope；回收桶的 route loader（`trashLocaleLoader`）一併載入 |
| `RestoreAction` | 每一列的還原操作元件（`{ item: TrashItem }`）：呼叫擁有者的還原 API、自己呈現錯誤 |

列表的欄位是共用的（名稱與描述、刪除時間、刪除者、預計永久刪除），由回收桶頁渲染；類型特有的只有還原操作。
後端 `TrashItem` 的形狀本來就是各類型共用的，所以不需要各類型提供欄位定義。

## 3. 權限

| 層 | 規則 |
| --- | --- |
| 頁面（`TRASH_PAGE`） | `match: SOME` 的 `TRASH_PAGE_PERMISSIONS`（`[user:delete, role:delete]`）：至少能刪一種才進得去、選單才出現。與後端 `TRASH_PERMISSIONS` 是同一組鍵，新類型兩邊一起加 |
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
| 依賴圖：`user`、`role` 的 create／delete 讓回收桶失效 | `apis/__tests__/resources.test.ts` |
