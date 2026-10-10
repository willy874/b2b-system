# 使用者與角色詳情

- 優先度：P2
- 狀態：提案
- 依賴：— （整頁詳情沿用 [`backend/20-approval.md`](../architecture/backend/20-approval.md) §11.3、§12.2 D1 的做法；資源頁面板 [`frontend/22-comment.md`](../architecture/frontend/22-comment.md) §2；
  授權說明 [`iam/08-explain.md`](../architecture/iam/08-explain.md)；角色版本紀錄 [`frontend/14-revisions.md`](../architecture/frontend/14-revisions.md)；不需要修訂既有的設計決策）
- 相關：路由 [`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §2.1（對話框即路由）、[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §5（頁面 × 權限）、§9（依賴樹）；
  [`04-sso.md`](../architecture/04-sso.md) §6.1（外部 IdP 頁面）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

使用者、角色與外部 IdP 是每個租戶最先設定、最常回來看的三個頁面，但它們還是第一版的對話框與表格（以下路徑相對 `apps/backstage/src/features/`）：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 打開一位使用者 | `user/pages/UserDetail/page.tsx:43-96` 是 `size="lg"` 的對話框，`:71-94` 由上往下堆 11 個區塊（頭像、基本資料、角色、標籤、群組、部門、有效權限、API token、外部身分、MFA、留言面板） | 權限齊全時一打開就發約 10 個查詢（頁面 3 個 ＋ 群組、部門、MFA、外部身分、API token ＋ 留言與關注 2 個）；要捲很久才到 MFA 或留言；網址無法指到某個區塊 |
| 對某人重設密碼、刪除 | 只在列表的列動作：`user/pages/UserList/components/UserTable.tsx:187-228`；刪除的確認在 `UserList/page.tsx:239` 起 | 從通知、群組成員、角色持有者（`RouteLink to="user.detail"`）進到詳情的人得先關掉、回列表再找一次。詳情的 `UserBasicSection.tsx:143-165` 只有「解鎖」與「編輯」 |
| 看有效權限的來源 | 詳情裡的 `UserPermissionSourceSection` 開 `PermissionSourceDialog` | [`iam/08-explain.md`](../architecture/iam/08-explain.md) §5：詳情本身是對話框，來源只能做成一層、疊在上面逐層關閉 |
| 看角色有哪些權限 | `role/pages/RoleDetail/components/RolePermissionSection.tsx:22-26` 把明確授予的鍵攤成一排 Chip | 幾十個鍵不分資源，看不出「這個角色能管哪幾類東西」；回應裡已有 `resource`（`PermissionSchema`） |
| 儲存角色的權限 | `role/pages/RoleDetailPermission/page.tsx:102-110` 的頁尾只寫「將新增 N 項、移除 M 項」 | 按下儲存前看不到是哪些鍵；移除一個被很多人依賴的鍵很容易誤觸 |
| 複製角色 | `RoleDetail/page.tsx:72` 呼叫 `useRoleDuplicateMutation`，`role/hooks/useRoleMutations.ts:162-170` 只彈 toast | 使用者停在原角色；複製通常是為了改，還得回列表找「… 的副本」 |
| 「哪些角色能改使用者？」 | `apps/api/src/modules/permission/permission.controller.ts:16` 只有 `GET /permissions`（目錄） | 沒有反查；只能逐一打開角色。權限目錄頁（`permission/`）也沒有通往說明的入口 |
| 外部 IdP | `identity-provider/pages/IdentityProviderList/page.tsx`：`useState` 開表單對話框（`:32-34`）、ui 的 `Table`（`:165`）、狀態是純文字（`:81-85`） | 網址分享不了；沒有排序與欄位設定；啟停要打開整份表單（OIDC／SAML 的欄位都在）再儲存 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 使用者詳情改整頁 ＋ 分頁籤（§1），路徑維持 `/user/$userId`、route id `user.detail` 不變 | 保留對話框、另做整頁；Drawer 快速檢視（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §12.3 評估過而不採用） |
| 詳情加「重設密碼」「刪除」（§1.3） | 管理者代設密碼（一律走重設連結，`user.create.activationHint`）；手動永久刪除（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D9、§9.4） |
| 角色的權限依資源分組、儲存前列出增減的鍵（§2） | 使用者的版本紀錄（版本歷史是選擇性加入，[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D1、D12；要加另開提案） |
| 複製角色後進到新角色（§2.3） | 通用的 `GET /authz/explain?object=…`、「為什麼不能」的缺口推算（[`iam/08-explain.md`](../architecture/iam/08-explain.md) §6） |
| 反查「哪些角色帶有某權限鍵」與權限目錄的說明入口（§3） | 列表顯示留言數（[`backend/24-comment.md`](../architecture/backend/24-comment.md) §8.2 D12） |
| 外部 IdP 改路由對話框、`RichTable`、狀態 Chip、列上的啟停（§4） | 角色詳情整頁化（見開放問題 4）；群組、服務帳號、Webhook 的詳情（照本提案的結果另做） |

## 使用者故事

**作為租戶管理者，我希望從通知點進某位使用者後直接重設他的密碼，以便不必回列表再找一次。**

- **Given** 我有 `user:read`、`user:resetPassword`，收到「有人在 王小明 留言提及你」的通知
- **When** 點通知進到 `/user/<id>`，在頁首的操作選單按「重設密碼」並確認
- **Then** 重設連結寄出、留下稽核；我停在同一頁，可以切到「留言」分頁回覆

**作為租戶管理者，我希望儲存角色權限前看到具體增減了哪些權限，以便不會誤拿掉別人依賴的權限。**

- **Given** 「客服」角色有 40 個鍵，我取消勾選「使用者 › 刪除」並新增「標籤 › 編輯」
- **When** 按「儲存」
- **Then** 確認框依資源分組列出「新增：標籤 › 編輯」「移除：使用者 › 刪除」與持有者人數；確認後才送出

**作為稽核人員，我希望查出哪些角色帶有 `user:update`，以便檢查誰能改使用者。**

- **Given** 我有 `permission:read`、`role:read`
- **When** 在權限目錄點「使用者 › 編輯」，打開「持有的角色」
- **Then** 看到明確授予的角色與經依賴樹帶出（由 `user:create`、`user:delete` 帶出）的角色各一組，每列連到 `role.detail`；有 `authz:explain` 時另有「檢查某位使用者」

## 初步構想

### 1. 使用者詳情整頁

- **路由**：`UserDetailRoute` 從 `UserListRoute` 的子路由改成 `RootRoute` 下的 `/user/$userId`（與 `UserImportRoute`、`ApprovalDetailRoute` 同一個形狀），
  `validateSearch` 帶列表的條件 ＋ `tab`；「回到列表」還原篩選。路徑不變，所以既有的網址、通知與 `RouteLink to="user.detail"` 都照常可用；
  舊網址上的列表參數（`?keyword=…`）成為回到列表時的條件。頁面權限仍由 `USER_PAGE` 以最長前綴涵蓋；`/user/create`（`USER_CREATE_PAGE`，CLAUDE.md「建立對話框的權限」）與 `/user/import` 不受影響。
- **版面**：頁首（頭像、顯示名稱、email、狀態 Chip、操作選單）＋ `Tabs`（`?tab=`，預設 `overview`）：

| 分頁 | 區塊 | 查詢 |
| --- | --- | --- |
| 總覽 | 基本資料、角色、標籤、群組、部門 | 進頁時 |
| 權限 | 有效權限與來源：`PermissionSourceDialog` 的內容直接放在頁面上（左清單、右來源），不再疊對話框 | 切到分頁時 |
| 安全性 | MFA、外部身分、API token | 切到分頁時 |
| 留言 | `<ResourcePanels resourceType="user">`（[`frontend/22-comment.md`](../architecture/frontend/22-comment.md) §2；面板仍由 `features/comment` 登記） | 切到分頁時 |

  分頁依權限隱藏（沒有 `authz:explain` 也不是本人就沒有「權限」）。`UserBasicSection` 的 `useFormDraft`、`useUnsavedChangesGuard` 照舊；換分頁不是導覽，編輯中的區塊不卸載（開放問題 2）。
- **刪除與重設密碼**：頁首的操作選單沿用列表的 mutation（`useUserDeleteMutation`、`useUserResetPasswordMutation`）與確認文案；刪除成功後帶 `ignoreBlocker: true` 回到列表，
  toast 的「復原」照舊。自己不能刪自己（`user.delete.selfProtected`）。解鎖從基本資料搬到同一個選單。
- `features/user/pages/UserDetail/` 拆成 `page.tsx`（頁首與分頁）＋ `tabs/`；只有 backstage 用，留在 app，不進 web-core。

### 2. 角色的權限

1. **依資源分組**：`RolePermissionSection` 以 `item.resource` 分組，組名用 `permission.resource.<resource>`、組內照 `sortOrder`；每組顯示「N 項」，超過一定數量時收合。
2. **儲存前的差異**：`RoleDetailPermission` 的「儲存」先開確認框（`ConfirmDialog`）列出 `diffKeys` 的 `add`／`remove`，依資源分組、以名稱 ＋ 鍵顯示，
   附「持有者 N 人、群組 M 個」（已有 `getRoleUsersQueryOptions`）。只新增時是否略過確認見開放問題 3。後端不變（`PATCH /roles/:id/permissions` 已是 `add`／`remove` 的增減語意）。
3. **複製後帶到新角色**：`useRoleDuplicateMutation` 的 `onSuccess` 回傳新角色的 `id`，`RoleDetailPage` 導向 `/role/<新 id>`（保留列表條件）；有略過的權限（`skippedPermissions`）時 toast 照舊。

### 3. 權限反查與說明入口

- **後端**：`GET /permissions/:key/roles`（`modules/permission`，`@RequirePermissions(permission:read, role:read)`）回 `{ explicit: Role[], implied: { role, via: key }[], superAdmin: Role[] }`：
  `explicit` 是 `tenant:self#<key>@role:*#holder` 的角色，`implied` 由依賴樹（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §9）反推帶出它的鍵，
  super-admin 另列。查詢在 `PermissionRepository`，不經 `core/authz` 的判斷器；已刪除的角色以 `notDeleted(roles)` 排除。
- **前端**：權限目錄（`features/permission`）選中一個鍵時多一個「持有的角色」區塊（連到 `role.detail`）；有 `authz:explain` 時多「檢查某位使用者」，
  挑人後連到 `user.detail` 的「權限」分頁並帶 `?key=` 預先選中那一列。
- 「哪些使用者有這個鍵」（展開群組與角色的閉包）不在這一版（開放問題 5）。

### 4. 外部 IdP 頁面

- 路由對話框：`/identity-provider/create`、`/identity-provider/$id`（編輯），表單改用 `useUnsavedChangesGuard`（[`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §2.1）。
  建立對話框另註冊 `IDENTITY_PROVIDER_CREATE_PAGE`（`identityProvider:read` ＋ `identityProvider:create`），與使用者、角色的建立對話框同一個理由。
- 表格改 `RichTable`（`@b2b-system/web-core/components`）：名稱、協定、網域、狀態、更新時間可排序（前端排序，連線數很少）。
- 狀態用 `Chip`（啟用／停用）；有 `identityProvider:update` 時列上有 `Switch`，送 `PATCH /identity-providers/:id { enabled }`，停用前確認「這個網域的使用者將無法以外部 IdP 登入」。
  `identity_providers` 沒有 `version` 欄（樂觀鎖見開放問題 6）。

### 5. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/backstage/src/features/user/routes/pages.ts`、`pages/UserDetail/**` | 整頁、分頁籤、頁首操作；測試的三個權限案例改寫 |
| `apps/backstage/src/core/components/ExplainPath/` | `PermissionSourceDialog` 的內容抽成可內嵌的 `PermissionSourcePanel`（對話框照樣給個人資料頁用） |
| `apps/backstage/src/features/role/pages/RoleDetail/components/RolePermissionSection.tsx`、`pages/RoleDetailPermission/page.tsx`、`hooks/useRoleMutations.ts` | §2 |
| `apps/api/src/modules/permission/`（controller、service、repository、dto） | §3 的端點；重新產生 openapi 與 SDK |
| `apps/backstage/src/apis/permission/get-permission-roles/`（新）、`features/permission/pages/PermissionList/` | §3 的前端 |
| `apps/backstage/src/features/identity-provider/**` | §4；`permission.ts` 的新頁面鍵 |
| `apps/e2e`（使用者、角色、外部 IdP 的 spec）、`docs/guide/introduction/03-feature-tour.md` 的截圖 | testid 與流程 |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **分頁籤還是單頁捲動加錨點？** (a) 分頁籤，非預設分頁延後查詢；(b) 單頁兩欄（左：基本資料與關係，右：安全性與留言），像審批詳情。傾向 (a)：區塊太多，延後查詢是主要收益。
2. **編輯中切分頁怎麼辦？** (a) 各分頁保持掛載（隱藏），草稿不丟；(b) 切換時卸載並以 `useFormDraft` 保留；(c) 有未儲存時擋下切換。傾向 (a)，只有「總覽」有可編輯的表單。
3. **權限差異的確認框什麼時候出現？** (a) 每次儲存；(b) 只在有移除時；(c) 移除超過 N 個或角色有持有者時。傾向 (b)：新增的風險在反提權已由後端擋下。
4. **角色詳情要不要也整頁化？** 它的權限與版本紀錄已是子路由對話框（`xl`），放進整頁的分頁籤會更一致，但 `/role/$roleId/permission` 的網址與頁面權限（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §5）要一起改。傾向這一版不做，看使用者詳情整頁後的反應。
5. **反查要不要列到使用者？** 列出「有這個鍵的所有人」要展開群組（巢狀）與角色，量大時要分頁與快取；也和 explain 的遮蔽規則（[`iam/08-explain.md`](../architecture/iam/08-explain.md) §2）有關。傾向只列角色（＋持有者人數），要看人走角色詳情。
6. **外部 IdP 要不要補 `version`？** 列上的啟停只改一個欄位，後寫者勝的影響小；但編輯表單與啟停並存時可能蓋掉對方的變更。傾向這一版補上（[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 的慣例），要一個租戶 migration。
7. **重設密碼與刪除要不要也放在列表？** 傾向保留列表的列動作（批次與快速操作仍在列表），詳情是第二個入口。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/frontend/04-routing.md` §2：路由樹（`/user/$userId` 整頁、外部 IdP 的路由對話框）
- `docs/architecture/frontend/22-comment.md` §2、`docs/architecture/iam/08-explain.md` §5：面板與有效權限改在使用者詳情的分頁
- `docs/architecture/iam/08-explain.md` §3 或 `backend/05-rbac.md`：`GET /permissions/:key/roles`；設計決策放在主要的那份
- `docs/architecture/iam/02-permission-catalog.md` §5：`IDENTITY_PROVIDER_CREATE` 頁面鍵；`docs/architecture/04-sso.md` §6.1：外部 IdP 頁面
