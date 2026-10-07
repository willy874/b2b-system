# RBAC 09 — 授權的說明（為什麼能做 X）

> 決策見 [`rbac/01-domain-model.md`](01-domain-model.md) §9.3 D14；關係圖見 [`01-domain-model.md`](./01-domain-model.md) §6.4、
> 群組見 [`08-groups.md`](./08-groups.md)。

權限會經過群組（含巢狀）、角色、權限依賴樹、資料夾繼承。「這位使用者為什麼能刪除這個資料夾」要能直接回答，
管理者才知道該拔掉哪一條授權。說明 **只讀**，不改變任何授權。

---

## 1. 路徑

一條說明是從 **使用者本人** 出發、走到某個能力的節點序列：

```
user:alice
  → group:角色設計#member            直接所屬的群組
  → group:美術#member                上層群組（巢狀）
  → fileFolder:素材#viewer           授權給群組的等級
  → fileFolder:角色#viewer           沿 inherits_from 繼承
  → fileFolder:角色#can_read         等級蘊含的動作
```

- 判斷器（`AuthzChecker.explain()`）的路徑從主體閉包裡的主體開始（例：`group:美術#member`）；主體閉包另外記下每個主體是怎麼來的
  （`AuthzRepository.closurePaths`：每個主體附上從本人走到它的最短鏈），兩段以 `withClosurePath` 接起來才是完整的路徑。
- 全域權限的來源不靠判斷器：`AuthzService.tenantSourcesOf` 列出使用者在租戶節點上 **直接** 取得的每一條邊與它的鏈，
  依賴樹帶出的鍵由閉包推出——所以一個鍵的 **所有** 來源都列得出來，不只第一條。

## 2. 誰能看、看得到什麼（D14）

| 情境 | 規則 |
| --- | --- |
| 查自己 | 不需要任何權限 |
| 查別人 | 需要 `authz:explain`（admin、auditor 預設持有；依賴 `user:read`、`role:read`、`group:read`）；沒有 → `403 AUTHZ_FORBIDDEN` ＋ `authz.denied` 稽核 |

路徑上的節點依 **操作者**（不是被查的人）遮蔽，讀不到的只回種類（`hidden: true`，`id`、`name` 是 null），段數與關係照樣回：

| 節點 | 操作者看得到的條件 |
| --- | --- |
| 使用者 | 本人、`user:*`（所有人），或有 `user:read` |
| 群組 | 有 `group:read`，或操作者 **直接** 所屬的群組 |
| 角色 | 有 `role:read`，或操作者 **直接** 持有的角色 |
| 資料夾 | 操作者在那個資料夾有 `can_read` |
| 租戶（權限鍵）、根目錄 | 一律 |

所以一般使用者查自己時，看得到自己直接所在的群組與直接持有的角色，上層群組與經由群組取得的角色顯示成「某個群組」「某個角色」——
知道經過幾層、是什麼種類，可以拿去問管理員。

## 3. API

| Method | Path | 宣告 | 回應 |
| --- | --- | --- | --- |
| GET | `/users/:id/permission-sources` | `@Authenticated`（自己；別人要 `authz:explain`，service 判斷） | `isSuperAdmin`、`superAdminVia`（怎麼成為 super-admin）、`items[]`：每個有效的權限鍵（目錄順序）與所有來源 `{ grantedKey, via[] }`；`grantedKey` 與鍵不同時，鍵是由它經依賴樹帶出的 |
| GET | `/file-folders/:id/explain?userId=` | `@Authenticated`（同上） | 五個動作（read、create、update、delete、share）各自 `allowed` 與 `path`（不能做時是 null） |

節點的形狀（`ExplainNode`）：`{ type, id, relation, name, hidden }`。路徑的起點 `relation` 是空字串。

「自己或有權限」無法以路由宣告表達，所以兩個端點都宣告 `@Authenticated()`、由 service 判斷，拒絕的形狀與 `PermissionsGuard` 相同。

## 4. 模組

| 位置 | 職責 |
| --- | --- |
| `core/authz` | `closurePaths`、`tenantSourcesOf`、`withClosurePath`（不認識任何業務） |
| `modules/authz-explain` | `assertCanExplain`、`describePaths`（查 user／group／role 的名稱、依 §2 遮蔽）、`GET /users/:id/permission-sources` |
| `modules/file`（`FileAccessExplainService`） | 以目標使用者建立檔案的判斷器取路徑、接上閉包的來歷；資料夾的名稱與可見性以 resolver 交給 `describePaths` |

要說明其他資源（之後的文件、訂單等）時照檔案的做法：擁有者模組取路徑，`describePaths` 的 resolver 補上自己的節點；
`authz-explain` 不依賴擁有者模組。

## 5. 前端

| 位置 | 內容 |
| --- | --- |
| `core/components/ExplainPath` | 路徑：圖示 ＋ 名稱，資料夾附等級或動作；讀不到的節點顯示「某個群組」等種類 |
| `core/components/ExplainPath/PermissionSourceList` | 有效權限的清單：每個鍵的所有來源，依賴樹帶出的標「由 X 帶出」，super-admin 另外說明 |
| 個人資料頁「我的有效權限」 | 查自己（不需要權限：沒有 `user:read` 的人也看得到） |
| 使用者詳情「有效權限」 | 自己，或有 `authz:explain` 時看別人 |
| 資料夾共用對話框「檢查存取」 | 有 `authz:explain` 時：挑一位使用者，列出每個動作與路徑 |

說明的 query 只在展開時查。資源依賴圖上歸在前端專屬的 `authzExplain`：使用者（更新、刪除）、指派角色、角色（更新、刪除）、權限鍵、
群組、資料夾的任何變更都讓它整批失效（[`../architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §6.2）。

## 6. 不在這一版

- 「為什麼 **不能**」的最接近缺口：不能做時只回 `allowed: false`，不推算差哪一條授權。
- 通用的 `GET /authz/explain?object=…`：資源的結構邊只有擁有者模組載入得了，所以說明由擁有者模組提供端點（§4）。
- 403 頁連到說明：拒絕的稽核沒有路徑可帶。

## 7. 測試

| 測試 | 涵蓋 |
| --- | --- |
| `apps/api/src/modules/authz-explain/__tests__/authz-explain.service.spec.ts` | 自己／`authz:explain`／403 與稽核；遮蔽規則（直接所屬顯示、上層遮蔽、resolver） |
| `apps/api/test/authz-explain.spec.ts` | 真 DB：權限來源（遮蔽、admin 看全部、依賴樹、super-admin）；資料夾說明（巢狀群組＋繼承的完整路徑、403） |
| `apps/api/test/groups.spec.ts` | `closurePaths`、`tenantSourcesOf` |
| `apps/backstage/src/core/components/ExplainPath/ExplainPath.test.tsx` 等 | 路徑的呈現、個人資料、使用者詳情、共用對話框的三種權限情境 |
