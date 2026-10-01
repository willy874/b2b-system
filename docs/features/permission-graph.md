# 權限圖（Relationship-based Access Control）：G4b、G5

- 優先度：P0
- 狀態：實作中（G0～G4a 已上 main 並歸檔）；**G4b（explain）實作中**（branch `feat/permission-graph-g4b`）；G5（專案）待做
- 依賴：—
- 相關：[ADR-0024](../adr/0024-relationship-based-access-control.md)（本功能的決策，G4 的 D10～D16）、
  [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4（圖的組成與模型）、
  [`rbac/08-groups.md`](../rbac/08-groups.md)（群組）、
  [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1（反提權）、§4.2（引擎）、§5（revision 失效）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 已上線的部分

| 階段 | 內容 | 正式文件 |
| --- | --- | --- |
| G0～G3b（2026-09-30） | 三套機制（全域 RBAC、資料夾授權、擁有者規則）收斂成同一張關係圖；權限依賴樹；revision ＋ 平台 DB 廣播的失效；舊表刪除 | ADR-0024 D1～D9、`rbac/01-domain-model.md` §6.4、`rbac/02-permission-catalog.md` §9、`rbac/07-resource-grants.md` §2.1、`backend/02-database.md` §2.10、§2.11、`backend/05-rbac.md` §4.2、§5 |
| G4a（2026-10-01） | 群組（巢狀、持有角色、資料夾授權給群組）；反提權一般化（模型宣告能力、引擎算出取得的能力） | ADR-0024 D10～D13、D15、D16、`rbac/08-groups.md`、`backend/05-rbac.md` §4.1 |

這份提案只剩下還沒做的部分。

## 背景

1. **沒辦法回答「他為什麼能做 X」**：路徑會經過群組（含巢狀）、角色、資料夾繼承。引擎已有 `AuthzChecker.explain()`，但沒有 API 與畫面。
2. **專案**：編輯器的資源會以專案為單位授權；專案應該是資料夾（與之後的關卡）的上層。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| G4b：「為什麼能／不能」的說明 API、使用者詳情的「有效權限（含來源）」、資料夾共用對話框每一列的「為什麼」 | 通用的 ListObjects（「列出我能讀的所有東西」） |
| G5：`project` 型別，成為資料夾的上層 | deny／排除（D4）、過期以外的條件式權限 |

## 使用者故事

**作為租戶管理者，我希望看到「Alice 為什麼能刪除這個資料夾」，以便決定要拔掉哪一條授權。**

- **Given** Alice 經由「美術組 → 專案 X 的 editor → 資料夾繼承」拿到刪除權
- **When** 在資料夾的共用對話框點 Alice 的「為什麼」
- **Then** 顯示完整路徑，且每一段都可以點到對應的管理頁

**作為開發者，我希望新增「關卡」這種資源時只要宣告它的關係與能力，以便不用再寫一套解析、快取與反提權。**（G5 起）

## 初步構想

### 1. 說明（explain，G4b）

```
user:alice
  → group:角色設計#member
  → group:美術#member
  → fileFolder:素材#editor
  → fileFolder:角色（inherits_from 素材）#editor
  → can_delete
```

- `GET /users/:id/effective-permissions`：全域權限鍵，每個鍵附來源（哪個角色、經由哪個群組、明確或由依賴樹帶出）。使用者詳情頁顯示「有效權限」。
- `GET /authz/explain?object=fileFolder:<id>&relation=can_delete&user=<id>`：共用對話框的「為什麼」。沒有路徑時回「沒有路徑」與最接近的缺口。
- 揭露範圍依 **D14**：路徑上操作者沒有讀取權（`group:read`、`role:read`、資料夾的 `can_read`）的節點只回型別，不回 id 與名稱；
  使用者直接所屬的群組、直接持有的角色一律顯示。查自己不需要權限；查別人要 `authz:explain`。
- **實作要注意**：`AuthzChecker.explain()` 的路徑從主體閉包裡的主體開始（例：`role:r#holder`），閉包是怎麼來的
  （`user → group → group → role`）沒有記錄。`AuthzRepository` 的閉包 CTE 要多帶一個路徑陣列欄，explain 才能串出完整路徑。
- 拒絕的稽核 `authz.denied` 的 `metadata` 不帶路徑（沒有路徑可帶），但前端的 403 頁可以連到說明頁。

權限：

| 權限鍵 | 說明 | 依賴 |
| --- | --- | --- |
| `authz:explain` | 查看任何人的有效權限與說明路徑（稽核人員、管理員） | `user:read`、`role:read`、`group:read`（路徑會經過這三種節點） |

### 2. 專案（G5）

`project` 型別，`fileFolder` 的 `inherits_from` 可以指向專案；專案成員（`project:P#member`）自動成為底下資料夾與關卡的某個等級。
模型上多一個型別、一條 `inherits_from` 的邊與它的能力宣告（`defineType(…, { capabilities })`），判斷器與反提權會沿著走（07 §10.1）。
專案成員的管理大概會是第一個需要「下放」的地方（D16 的後續）：要做時先重新評估 D13（放進主體時不檢查它在資源上的授權）。

## 分階段

| 階段 | 內容 |
| --- | --- |
| **G0～G4a** ✅ | 見「已上線的部分」 |
| **G4b** | §1：explain API、有效權限、「為什麼」 |
| **G5** | §2：`project` 型別 |

## 開放問題

G4 的問題（3 角色繼承、4 群組成員的反提權、6 explain 的揭露範圍、7 外部 IdP 群組對應、11 群組管理下放）已於 2026-10-01 結論，
寫在 ADR-0024 D10～D16；選項與取捨保留在 ADR 的「替代方案」。G4b 依 D14 實作，沒有未決的問題。

1. （G5）專案成員對應到資料夾的哪個等級？是固定的，還是每個專案可以設定？

## 歸檔去向

- G4b：`docs/architecture/backend/05-rbac.md` §4（explain API）、`docs/rbac/02-permission-catalog.md`（`authz:explain`）、
  前端的有效權限與「為什麼」寫進 `docs/rbac/08-groups.md` 或另開一份；ADR-0024 加 G4b 的實作紀錄
- G5：隨專案功能的提案一起歸檔；全部完成後刪除本檔
