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

## 進度與剩餘工作

第一批已合進 `main`（`da1baa4`，merge `85b011d`）：資料表與遷移、權限範圍、`@WorkspaceScoped` guard 與 route-audit、
`modules/workspace`（平台管理、成員與工作區角色）、檔案模組移進工作區、推播、前端 `/w/:workspaceSlug` 版面、
切換器、成員頁、平台的工作區管理頁。以下是還沒做的，合併前要逐項處理或明確延後。

### 功能

1. ~~**Email 邀請（ADR-0018 D14）**~~ ✅ 已完成（`refactor/rename-web-to-backstage` 工作目錄，尚未 commit）。做出來的樣子，歸檔時寫進正式文件：
   - 資料：`workspace_invitations`（email、`token_hash`、到期、邀請人、接受／撤銷時間；同工作區同 email 只有一筆待接受，
     partial unique index）＋ `workspace_invitation_roles`（migration 0017）。`token_hash` 在寄出當下才寫入，每次寄出換新並重新起算 7 天。
   - API：`GET/POST /workspaces/:workspaceId/invitations`、`DELETE …/invitations/:invitationId`（撤銷，`workspaceMember:create`）；
     受邀者用的 `GET /workspace-invitations/preview`（公開）、`POST /workspace-invitations/accept`（登入，帳號 email 必須是受邀的 email）、
     `POST /workspace-invitations/signup`（公開，建立 **已啟用** 帳號、沒有全域角色，前端接著登入）。
   - 規則：角色受反提權限制（邀請時檢查；之後邀請人權限變了靠撤銷處理）；已是成員 → `WORKSPACE_MEMBER_DUPLICATE`；
     沒有帳號的 email 需要平台的 `user:create`；重新邀請同一個 email 會撤銷舊的；接受時角色與既有角色取聯集。
   - 寄信：背景工作 `workspace.invitationMail`（`modules/workspace/workspace-invitation.jobs.ts`）；稽核 `workspaceInvitation.create/revoke/accept`、
     `mail.send`；推播 `ChangeSource.WORKSPACE_INVITATION`（受眾：該工作區持有 `workspaceMember:read` 的人）。
   - 前端：成員頁的「邀請成員」對話框與待接受邀請清單（backstage 的 `features/workspace`）；接受邀請頁已隨 SSO 搬到 apps/auth 的 `/invitation`
     （[`sso.md`](./sso.md) 交付順序 3）：新帳號建立後頂層跳轉到 backstage 的工作區，由 IdP 登入；已有帳號的人經 SSO 登入後接受。
   - 已知限制：登入的是別的帳號時，只提示「請登出後用受邀的信箱登入」（要重新點信）；
     `pending`（還沒啟用）的既有帳號收到邀請時，要先完成啟用才能登入接受；工作區管理員可以從
     `WORKSPACE_INVITATION_USER_CREATE_REQUIRED` 推知某個 email 在平台上沒有帳號。
2. **稽核依工作區篩選（D6）**：`audit_logs`／`audit_logs_archive` 加 `workspace_id`；`archive_audit_logs()` 與
   `audit_logs_guard_delete()` 的欄位清單要一起改，改完重新 `ALTER FUNCTION … SECURITY DEFINER`（見 migration 0003、0014）；
   `AuditService.record()` 帶上工作區（目前工作區相關的稽核放在 `metadata.workspaceId`）；稽核列表 API 與頁面加篩選。

### 測試

3. **前端頁面測試**：`WorkspaceMembers`、`WorkspaceAdminList` 的三個權限案例（有權限／沒權限／未水合）與 MSW handler；
   `WorkspaceLayout`（slug 不存在 → 404、非成員、切換工作區清掉權限）；`WorkspaceSwitcher`；`core/permission` 的
   `usePageAccess(level)`、`resolvePageKey` 的 `$param` 比對、`routeBasePath` 接上層路徑；`core/workspace/paths.ts`。
4. **E2E**：A 工作區的成員看不到 B（`/w/e2e-other/...` 顯示找不到）；切換器保留同一頁；成員頁指派角色；
   平台管理員看不到工作區內容；邀請 → 從 Mailpit 取連結 → 新帳號設定密碼後進入工作區。seed 已準備 `e2e-other` 工作區（只有 e2e-admin 是成員）。

### 環境

5. **共用 dev 資料庫還沒 migrate**（0016 工作區、0017 邀請）：開發期間用的是副本 `ws_scratch`。套用 `pnpm db:migrate && pnpm db:seed` 會搬動資料、
   無法倒回，要在沒有其他對話依賴舊 schema 時執行。
6. dev 資料的 `admin` 角色先前被縮成只有 `file:access`、`file:share`，遷移出來的 `workspace-admin` 因此沒有 `file:read`，
   無法指派 `workspace-viewer`（反提權照規則擋下）。要的話在角色頁補權限，或重建 dev 資料。

### 已知限制（決定延後或接受）

7. 不是成員的 super-admin 瀏覽工作區時收不到推播，資料靠重新聚焦時重抓（D16）。
8. 成員被移出工作區時，他在那裡的個人資料夾保留（進不去但資料還在）；只有使用者被刪除時才清空的個人資料夾。
9. 工作區只有軟刪除，這一版沒有還原與硬刪除／資料清除。
10. `approval_requests` 沒有加 `workspace_id` 欄位：`fileFolder.access` 的工作區記在 payload；審批頁若要依工作區篩選再加。
11. SDK 的 `CreateRoleRequest.scope` 變成必填（後端 schema 有預設值，但 OpenAPI 以輸出型別產生）；前端一律帶上，暫不處理。

### 歸檔（合併時，依 [`README.md`](./README.md) §3.3）

12. 寫正式文件：`docs/rbac/08-workspace.md`、`docs/architecture/backend/12-workspace.md`、`docs/architecture/frontend/13-workspace.md`；
    更新 `rbac/01-domain-model.md`（實體、不變條件）、`05-seed-and-bootstrap.md`（工作區角色、預設工作區）、
    `07-resource-grants.md` §10、§12（專案 = 工作區、系統資料夾每工作區一套）、`backend/06`、`08`、`09`、
    `frontend/04`、`05`、`06`、`11`、`12`、`docs/README.md` 文件地圖、`overview/`；
    ADR-0018 狀態改「採用」，ADR-0006、ADR-0015 標註被取代的部分；CLAUDE.md（常用指令、與文件不同的實作決定）；
    刪除本檔與 backlog 那一列。

## 歸檔去向

- `docs/adr/0018-workspace-tenancy.md`：狀態改為「採用」；ADR-0006、ADR-0015 標註被它取代的部分
- `docs/rbac/08-workspace.md`：新增。更新 `rbac/01-domain-model.md`、`02-permission-catalog.md`（範圍欄位）、`05-seed-and-bootstrap.md`、`07-resource-grants.md` §10
- `docs/architecture/backend/12-workspace.md`：新增。更新 `backend/05-rbac.md`、`06-audit-log.md`、`08-realtime.md`、`09-file.md`
- `docs/architecture/frontend/13-workspace.md`：新增。更新 `frontend/04-routing.md`、`05-data-layer.md`、`06-permission.md`、`11-realtime.md`
