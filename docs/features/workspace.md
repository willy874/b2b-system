# 工作區／多租戶

- 優先度：P0
- 狀態：提案
- 依賴：—
- 相關：[ADR-0006](../adr/0006-flat-permission-scope.md)、[ADR-0015](../adr/0015-file-folder-access.md)、[`user-groups.md`](./user-groups.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

所有資料目前都放在同一個全域範圍。遊戲編輯器上線後，一定會出現「專案」這個單位：
不同專案的成員、資源、權限互相隔離。ADR-0015 也寫明 **未來資料夾會掛在「專案」底下**。

這件事越晚做成本越高：每一張業務表都要加 `workspace_id`，權限從「角色」變成「角色 × 工作區」，
權限快取的 key、推播的 room、稽核的篩選條件都要跟著改。所以要在第一個編輯器功能之前決定。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 工作區的建立、成員管理、切換 | 跨工作區共享資源 |
| 工作區內的角色指派（同一個人在不同工作區可以有不同角色） | 依工作區計費、用量配額 |
| 全域角色（平台管理）與工作區角色並存 | 資料庫層級的隔離（schema-per-tenant） |
| 業務資料都帶 `workspace_id`，查詢一律帶條件 | |

## 使用者故事

**作為工作區管理員，我希望邀請成員並指派工作區內的角色，以便只讓他們看到這個專案的資源。**

- **Given** 我是工作區 A 的管理員
- **When** 我把某位使用者加入工作區 A 並指派「美術」角色
- **Then** 他切換到工作區 A 時擁有美術權限；切換到工作區 B 時不受影響

## 初步構想

- 資料模型：`workspaces`、`workspace_members`；`user_roles` 加上可為空的 `workspace_id`（空值 = 全域角色）
- 權限解析：`PermissionService` 回傳「全域權限 ∪ 目前工作區權限」；快取 key 帶上工作區
- 請求帶工作區：路由前綴 `/workspaces/:id/...` 或 header。建議用路由前綴，稽核與快取都比較好追
- 前端：`core/workspace`（目前工作區的 store）＋ App Shell 的工作區切換器；切換時清掉 query 快取
- 推播：room 加上工作區維度
- 既有資源：使用者、角色維持全域；檔案資料夾掛到工作區底下

## 開放問題

1. 「專案」與「工作區」是同一層，還是工作區底下再分專案？
2. 角色定義是全域共用（只有指派分工作區），還是每個工作區可以自訂角色？
3. 資料夾 ACL（`resource_grants`）與工作區角色怎麼疊加？
4. 既有資料怎麼遷移：建立一個預設工作區，把現有資源全部歸進去？
5. 需要 Postgres Row-Level Security 當第二道防線嗎？

## 歸檔去向

- `docs/adr/NNNN-workspace-tenancy.md`（取代 ADR-0006 的剩餘部分）
- `docs/rbac/NN-workspace.md`、更新 `rbac/01-domain-model.md`
- `docs/architecture/backend/05-rbac.md`、`frontend/06-permission.md` 的權限解析章節
