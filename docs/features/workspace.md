# 工作區／多租戶

- 優先度：P0
- 狀態：實作中（branch：`feat/workspace`）
- 依賴：—
- 相關：[ADR-0018](../adr/0018-workspace-tenancy.md)（本功能的決定）、[ADR-0006](../adr/0006-flat-permission-scope.md)、[ADR-0015](../adr/0015-file-folder-access.md)、[`user-groups.md`](./user-groups.md)

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
| 全域角色（平台管理）與工作區角色並存 | 資料庫層級的隔離（schema-per-tenant）、Row-Level Security |
| 業務資料都帶 `workspace_id`，查詢一律帶條件 | 工作區底下再分專案 |
| 以 email 邀請成員（已有帳號或新帳號） | 工作區自訂角色 |
| 稽核依工作區篩選 | 工作區的硬刪除與資料清除（這一版只做軟刪除） |

## 使用者故事

**作為工作區管理員，我希望邀請成員並指派工作區內的角色，以便只讓他們看到這個專案的資源。**

- **Given** 我是工作區 A 的管理員
- **When** 我把某位使用者加入工作區 A 並指派「美術」角色
- **Then** 他切換到工作區 A 時擁有美術權限；切換到工作區 B 時不受影響

**作為工作區管理員，我希望用 email 邀請還沒有帳號的外包美術。**

- **Given** 我持有 `workspaceMember:create` 與平台的 `user:create`
- **When** 我邀請 `artist@example.com` 並指定「美術」角色
- **Then** 對方收到邀請信，點連結設定密碼後直接登入，並成為工作區 A 的美術

**作為平台管理員，我不應該看到工作區裡的檔案。**

- **Given** 我持有 `workspace:*`，但不是工作區 A 的成員
- **When** 我呼叫 `GET /workspaces/A/files`
- **Then** 回 404；我仍然能在工作區管理頁看到 A 的名稱與成員

## 初步構想

決定與理由見 [ADR-0018](../adr/0018-workspace-tenancy.md)；這裡只列實作要動到的地方。

- **資料模型**
  - 新增 `workspaces`、`workspace_members`、`workspace_member_roles`、`workspace_invitations`。
  - `roles`、`permissions` 加 `scope`；`workspace_members.last_accessed_at` 記錄最近進入的工作區。
  - `file_folders`、`files` 加 `workspace_id`（NOT NULL），並加上組合外鍵；系統資料夾的唯一索引加上 `workspace_id`。
  - `audit_logs`（含冷表）、`approval_requests` 加可為空的 `workspace_id`。
- **後端**
  - 新增 `modules/workspace`：工作區 CRUD、成員、角色指派、邀請。
  - `PermissionService.getPermissionSet(userId, workspaceId?)` 與權限快取改用新的 key。
  - `PermissionsGuard` 支援 `@WorkspaceScoped()`；`route-audit` 檢查權限鍵範圍與路由是否一致。
  - `modules/file` 的路由改掛前綴，系統資料夾改為每個工作區一份。
  - `modules/approval`：`fileFolder.access` 的申請帶上工作區。
  - `modules/realtime`：新增工作區的 room；連線時加入所屬每個工作區的 room。
  - 背景工作的 payload 帶 `workspaceId`。
- **前端**
  - 新增 `core/workspace`（從 URL 推導目前工作區）與 App Shell 的切換器。
  - 工作區頁面的路由改為 `/w/:workspaceSlug/...`。
  - `apis/` 裡工作區範圍的 query key 包含 `workspaceId`。
  - 新增 `features/workspace`（工作區管理、成員、邀請接受頁）。
- **權限**（草案，實作時寫進權限目錄）

  | 範圍 | 權限鍵 |
  | --- | --- |
  | platform | `workspace:create`、`workspace:read`、`workspace:update`、`workspace:delete` |
  | workspace | `workspaceMember:read`、`workspaceMember:create`（邀請）、`workspaceMember:delete`、`workspaceMember:assignRole`（受反提權限制） |
  | 改為 workspace | 既有的 `file:*` |

- **稽核**：`workspace.create/update/delete`、`workspaceMember.add/remove/assignRole`、`workspaceInvitation.create/revoke/accept`。
- **推播**：`ChangeSource.WORKSPACE`、`ChangeSource.WORKSPACE_MEMBER`。
- **交付順序**：
  1. 後端基礎：schema、遷移、權限解析、guard、`modules/workspace`
  2. 檔案移進工作區
  3. 前端
  4. 邀請、稽核篩選、E2E 與歸檔

## 開放問題

1. 「專案」與「工作區」是同一層，還是工作區底下再分專案？
   - **結論**：同一層。工作區就是 ADR-0015 說的「專案」，這一版不再往下分層（ADR-0018 D1）。
2. 角色定義是全域共用（只有指派分工作區），還是每個工作區可以自訂角色？
   - **結論**：全域共用，**不做**工作區自訂角色。角色與權限鍵都加上 `scope`，工作區角色只能含 workspace 範圍的鍵（ADR-0018 D2、D3）。
3. 資料夾 ACL（`resource_grants`）與工作區角色怎麼疊加？
   - **結論**：能力 = `P(u, W)` 有 `file:X` ∨ 資料夾等級允許 X。資料夾樹以工作區為根，工作區內的 `file:*` 等於「這個工作區的所有資料夾」；只有 super-admin 能跨工作區看內容（ADR-0018 D5、D7）。
4. 既有資料怎麼遷移：建立一個預設工作區，把現有資源全部歸進去？
   - **結論**：是。建立 `default` 工作區，所有資料夾、檔案、`fileFolder.access` 審批歸進去，所有使用者成為成員。角色的拆法：

     | 原本的角色 | 拆分後 |
     | --- | --- |
     | `admin` | 保留 platform 鍵；原本的 `file:*` 移到新的系統角色 `workspace-admin`（再加上成員管理） |
     | `member` | 原本的 `file:access` 移到新的系統角色 `workspace-member` |
     | `auditor` | 同上的拆法：platform 鍵留在原角色，workspace 鍵移到對應的工作區角色 |
     | 自訂角色 | 同時含兩種範圍的鍵時，拆成 `<name>` 與 `<name>（工作區）` 兩個角色 |

     接著處理指派與授權：
     - 持有這些角色的人，在 `default` 取得對應的工作區角色。
     - `resource_grants` 裡對象是角色的列，改指向拆出來的工作區角色。
     - 遷移過程寫入稽核（ADR-0018 D18）。
5. 需要 Postgres Row-Level Security 當第二道防線嗎？
   - **結論**：暫時不做。改用組合外鍵、`WorkspaceScope` 品牌型別、越權整合測試三道防線（ADR-0018 D10）。
6. 成員要怎麼加入：只能加入已經存在的使用者，還是用 email 邀請？
   - **結論**：做 email 邀請。已有帳號的人登入後接受；沒有帳號的人點連結後設定密碼、建立已啟用帳號。邀請沒有帳號的 email 時，邀請人另外需要平台的 `user:create`（ADR-0018 D14）。

## 歸檔去向

- `docs/adr/0018-workspace-tenancy.md`：狀態改為「採用」；ADR-0006、ADR-0015 標註被它取代的部分
- `docs/rbac/08-workspace.md`：新增。更新 `rbac/01-domain-model.md`、`02-permission-catalog.md`（範圍欄位）、`05-seed-and-bootstrap.md`、`07-resource-grants.md` §10
- `docs/architecture/backend/12-workspace.md`：新增。更新 `backend/05-rbac.md`、`06-audit-log.md`、`08-realtime.md`、`09-file.md`
- `docs/architecture/frontend/13-workspace.md`：新增。更新 `frontend/04-routing.md`、`05-data-layer.md`、`06-permission.md`、`11-realtime.md`
