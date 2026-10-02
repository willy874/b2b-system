# 前端 14 — 版本紀錄

> 狀態：**已實作**（角色：`features/role`，路由 `/role/$roleId/revision`；[`backend/14-revisions.md`](../backend/14-revisions.md) §9 R5）。後端的版本歷史見
> [`../backend/14-revisions.md`](../backend/14-revisions.md)；決策見 [`backend/14-revisions.md`](../backend/14-revisions.md) §9.2 D1、D10。

## 1. 組成

```
apis/role/get-role-revisions/          GET /roles/:id/revisions（ROLE_REVISIONS_QUERY_KEY）
apis/role/get-role-revision/           GET /roles/:id/revisions/:version（ROLE_REVISION_DETAIL_QUERY_KEY）
apis/role/revert-role-revision/        POST /roles/:id/revisions/:version/revert

features/role/routes/pages.ts          RoleDetailRevisionRoute（詳情的子路由 `revision`）
features/role/hooks/useRoleRevisionHistory.ts   列表、選中的一版、比較對象、JsonDiff 的兩邊
features/role/hooks/useRoleMutations.ts         useRoleRevertRevisionMutation
features/role/pages/RoleDetailRevision/
├── page.tsx                           對話框：版本列表 ＋ 差異 ＋ 還原到這一版
├── adapter.ts                         RevisionSummary → 列的 VM；兩版的權限鍵是否不同
└── components/RoleRevisionList.tsx    版本列表（新的在前、分頁）
```

入口是角色詳情對話框的「版本紀錄」按鈕（`role-revision-button`）。與「管理權限」一樣是 **對話框即路由**：網址可以分享，上一頁＝回到詳情。

## 2. 權限

| 對象 | 規則 |
| --- | --- |
| 頁面（路由） | 不另外註冊頁面權限：`/role/$roleId/revision` 在 `/role` 之下，由 `ROLE_PAGE`（`role:read`）以最長前綴涵蓋，與後端的 `GET /roles/:id/revisions` 相同 |
| 「還原到這一版」 | `useRolePermission().canUpdate`（`role:update`），而且不是系統角色（與詳情的編輯按鈕相同；後端只擋 super-admin，但畫面上系統角色本來就不能改名稱與權限） |
| 權限鍵會改變時 | 另要 `canGrantPermission`（`role:grantPermission`）；沒有就停用按鈕並說明（後端同樣會擋，[`../backend/14-revisions.md`](../backend/14-revisions.md) §4.3） |

權限未水合前不渲染還原按鈕（[`06-permission.md`](./06-permission.md) 的三態）。

## 3. 畫面

- **版本列表**（`RoleRevisionList`）：新的在前，一頁 20 筆（超過才出現分頁）。每一列：「第 N 版」、作者（系統寫入的基準版本顯示「系統」）、時間；
  最新一版標「目前」，快照過大未保存的標「過大未保存」。testid `role-revision-item` ＋ `data-value=<版本號>`。
- **差異**（`JsonDiff`，[`07-ui-system.md`](./07-ui-system.md) §3.12）：分頁切換比較對象——
  - 「與目前的內容比較」（預設）：變更前＝最新一版（每次寫入都產生一版，最新一版等於目前的角色），變更後＝選中的一版。也就是「還原之後會改變什麼」。
  - 「與前一版比較」：變更前＝版本號減一，變更後＝選中的一版。也就是「這一版改了什麼」。前一版不存在（第一版、已被保留清理刪除）時說明，差異顯示成整份新增。
  - 過大未保存的一版不顯示差異，改成說明。
- **還原到這一版**（`role-revision-revert`）：確認框（`role-revision-revert-confirm`）說明名稱、說明與權限會改回那一版、持有者的權限立刻改變、會產生新的一版。
  選的是最新一版、過大未保存、或權限鍵會改變而沒有 `role:grantPermission` 時按鈕停用並寫出理由。

## 4. 還原的流程

`useRoleRevertRevisionMutation`：

1. 送出時帶 **確認時** 看到的角色 `version`（樂觀鎖，[`../backend/03-api-conventions.md`](../backend/03-api-conventions.md) §11）。
2. 成功 → `invalidateResources`：`role` / `update` ＋ `rolePermission` / `update`（自己持有這個角色時 profile 跟著重抓）→ toast「已還原到第 N 版」。
   版本列表與單版的 query 在衍生資源 `Resource.ROLE_REVISION`（`apis/resources.ts`）：由 `role` / `update` 與 `rolePermission` 衍生，
   所以這裡、推播來的別人的修改都會讓版本列表重抓（新的一版出現在最上面）；持有者的變更不在快照裡，不影響。
3. `*_VERSION_CONFLICT` → 失效該角色、不彈 toast；頁面關閉確認框並顯示 `VersionConflictAlert`，「重新載入」重抓角色與版本後消失。
4. `AUTHZ_ESCALATION` → toast「這一版帶有你未持有的權限，無法還原」；確認框留著（可以取消）。
5. 其他錯誤（`REVISION_UNAVAILABLE`、`ROLE_NAME_DUPLICATE`、`AUTHZ_FORBIDDEN`…）交給 `useErrorToast`，確認框留著。

## 5. 讓另一個實體加上版本紀錄

後端照 [`../backend/14-revisions.md`](../backend/14-revisions.md) §6 加入之後：

1. `apis/<domain>/` 加三個操作（照角色的形狀），版本列表與單版的 query key 放進 `apis/resources.ts` 的一個衍生資源（照 `ROLE_REVISION`），
   從「會改變快照內容」的來源衍生。
2. feature 內照 `useRoleRevisionHistory` 寫一個 hook（列表、選中的一版、比較對象），頁面沿用同樣的版面與 `JsonDiff`。
3. 還原的 mutation 帶實體的 `version`、處理 `*_VERSION_CONFLICT`，並在成功時宣告實體與它的關聯被改了。

目前只有角色，還沒有抽出共用的元件；第二個實體加入時再把列表與差異的版面抽到 `core/` 或 `components/`（不含業務名詞的部分）。

## 6. 測試

| 對象 | 檔案 |
| --- | --- |
| 預設選最新一版、與目前或前一版比較、前一版不存在或已被清除（不重試） | `features/role/hooks/__tests__/useRoleRevisionHistory.test.tsx` |
| 列的 VM、權限鍵是否不同 | `features/role/pages/RoleDetailRevision/__tests__/adapter.test.ts` |
| 版本的 query 由角色的更新與權限鍵的變更失效，持有者的變更不影響 | `apis/__tests__/resources.test.ts` |
| 列表的標記、差異；還原的三個權限案例（只能讀、未水合、可以還原）；最新一版與過大未保存不能還原；缺 `role:grantPermission` 的說明；樂觀鎖衝突；反提權 | `features/role/pages/RoleDetailRevision/__tests__/RoleDetailRevisionPage.test.tsx` |

MSW（`mocks/handlers/rbac.ts`）：每個角色兩版（第 2 版等於目前的內容），讀要 `role:read`、還原要 `role:update`。
