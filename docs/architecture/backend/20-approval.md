# 後端 20 — 審批（Approval）

特定的變更不直接生效，而是先建立一筆 **審批請求**，由管理員核准後才套用。
第一個使用它的流程是 **使用者註冊**（`user.register`）：未登入的人送出申請，
管理員核准後才建立帳號。

審批類型可以設定 **多階段流程**（依序多關、會簽、條件分流；§9）。多階段可以由平台對每個租戶關閉（`approvalChain`），
審批本身（單關）常駐。

> 程式碼：後端 `apps/api/src/modules/approval/`（狀態機；多階段在 `approval-chain.*`、`approval-flow.*`）＋ 各類型的 handler
> （`user.register` 在 `apps/api/src/modules/user/user-registration.approval.ts`）；審核者規則 `manager`／`orgUnit` 在
> `apps/api/src/modules/organization/org-assignee.resolvers.ts`；
> 前端 `apps/backstage/src/features/approval/`（審批頁、我的審批）、`apps/backstage/src/features/approval-flow/`（流程設定）、註冊頁在 apps/platform。

---

## 1. 範圍

| 做                                                         | 不做                                              |
| ---------------------------------------------------------- | ------------------------------------------------- |
| 通用的請求 → 審核 → 套用 狀態機，新類型只需實作 handler    | 請求逾期自動作廢、催簽                            |
| `user.register`：匿名申請，核准後建立帳號                  | 加簽、轉簽、代理人（卡住時由 `approval:override` 處理，§9.8） |
| 審核時一併指派角色（受反提權限制）                         | 圖形化流程設計器、平行分支、運算式語言的條件      |
| 以郵件通知申請人審核結果（含審核意見；[`backend/11-mail.md`](11-mail.md) §4） | 對外 API 的審批端點、關卡層級的 webhook |
| 列表、詳情、核准、駁回；即時推播                           |                                                   |
| 多階段流程：依序多關、會簽、條件分流（§9；可由平台關閉）   |                                                   |
| 申請人查看自己的申請與進度、撤回（「我的審批」，§9.9、§9.10） |                                                |
| 待辦的入口、整頁的詳情、審核時的留言、修改後重新送出（§11）；流程設定的範本、摘要與自動試算（§9.16） | 審批專屬的聊天室；租戶自訂的流程範本 |

---

## 2. 資料模型

`approval_requests`（`apps/api/src/db/schema/approval-requests.ts`）：

| 欄位                                | 說明                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `type`                              | 請求類型，對應一個 handler（`user.register`）                                      |
| `status`                            | `pending` → `approved` \| `rejected` \| `withdrawn`（申請人撤回，§9.9）            |
| `subject_key`                       | 去重鍵（註冊 = 小寫 email）：同類型同對象同時只能有一筆待審                       |
| `payload`                           | 審核者看得到的內容（註冊 = `{ email, displayName }`）                              |
| `private_payload`                   | 只給 handler 用的內容（目前沒有類型使用；改版前的註冊申請存過密碼雜湊）。**永不回傳、不進稽核，審核後清空** |
| `requester_id` / `requester_name`   | 申請人；匿名申請（註冊）`requester_id = null`，名稱快照為 email                   |
| `reason`                            | 申請理由                                                                          |
| `reviewer_id` / `reviewer_name`     | 審核者（名稱快照：審核者之後被刪除仍可讀）                                        |
| `review_comment` / `reviewed_at`    | 審核意見與時間                                                                    |
| `result_resource_id`                | 核准後產生的資源（註冊 = 新使用者 id）                                            |
| `flow_id` / `flow_version` / `allow_repeat_approver` / `current_step` | 多階段（§9.3）；單關請求都是 null                    |
| `resubmitted_from`                  | 駁回或撤回後重新送出時，前一筆的 id（§9.9）                                       |

DB 層的不變條件（整合測試 `apps/api/test/approval-lifecycle.spec.ts` 證明擋得住）：

| 約束                                        | 內容                                                     |
| ------------------------------------------- | -------------------------------------------------------- |
| `approval_requests_pending_subject_key`     | `UNIQUE (type, subject_key) WHERE status = 'pending'`    |
| `approval_requests_reviewed_consistency`    | `(status = 'pending') = (reviewed_at IS NULL)`           |

---

## 3. 狀態機與規則

### 3.1 狀態

```
          submit                approve（handler.apply）
  (無) ─────────▶ pending ─────────────────────────────▶ approved
                     │ ├────── reject ─────────────────▶ rejected
                     │ └────── withdraw（申請人）───────▶ withdrawn
                     └ 多階段：current_step 隨關卡推進（§9.4）
```

- 只能從 `pending` 走一次。已審核的請求再核准／駁回 → `409 APPROVAL_ALREADY_REVIEWED`。
- 駁回後同對象可以重新申請（唯一索引只限制 `pending`）。

### 3.2 權限

| 動作 | 路由宣告          | service 另外檢查                                                           |
| ---- | ----------------- | -------------------------------------------------------------------------- |
| 讀取 | `@Authenticated()` | 全部（`scope=all`）要 `approval:read`；單筆是 `approval:read`、申請人或任一關的候選人（§9.10），看不到回 `404` |
| 駁回 | `approval:review` | 多關請求在 `approvalChain` 啟用時 `409 APPROVAL_CHAIN_IN_PROGRESS`（§9.11） |
| 核准 | `approval:review` | 同上；handler 的 `requiredPermissions()`；缺少 → `403 AUTHZ_FORBIDDEN` ＋ `missing` |
| 關卡的決定、override、refresh、撤回 | 見 §9.13 | — |

**核准等同代為執行該操作**，所以審核者自己必須做得到——否則 `approval:review` 會變成繞過
`user:create` 的後門。`user.register` 要求 `user:create`；核准時指派角色再加 `user:assignRole`，
且角色受反提權限制（[`iam/04-api.md`](../iam/04-api.md) §4）。

前端的 `useApprovalPermission()` 同步反映：只有 `approval:review` 時可以駁回，核准鈕停用並說明原因。

### 3.3 四眼原則

`requester_id = reviewer` → `403 APPROVAL_SELF_REVIEW`。匿名申請（註冊）不適用；
之後由登入者送出的請求類型自動受保護。

### 3.4 核准的交易順序

```
① 讀取請求、檢查 pending／四眼、權限、handler.assertApprovable()   （交易外，失敗不寫任何東西）
② BEGIN
   ├ UPDATE … SET status='approved', private_payload=NULL WHERE id=? AND status='pending'
   │   └ 0 列 → APPROVAL_ALREADY_REVIEWED（併發核准的輸家在建立任何東西之前 rollback）
   ├ handler.apply(tx)             例：建立使用者 ＋ 指派角色 ＋ user.create 稽核
   ├ 寫回 result_resource_id
   ├ approval.approve 稽核
   ├ 入列結果信（approval.resultMail）
   └ 站內通知給申請人（approval.result；匿名的註冊沒有收件人）
   COMMIT
③ handler.afterApply()             快取失效、該變更自己的領域事件（例：user create）
④ 發佈 approval update
```

與 [`../coding-standards/03-backend.md`](../../coding-standards/03-backend.md) §1 規則 6 一致：稽核在交易內，
快取失效與事件在交易後。

批次核准／駁回沒有專用端點，由前端逐筆呼叫單筆 API，見 [`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13。

送出請求時，送出當下持有 `approval:review` 的人（不含申請人自己）在同一個交易內各收到一則站內通知 `approval.pending`
（[`backend/15-notification.md`](15-notification.md) §12.2 D5、D11；[`15-notification.md`](15-notification.md) §4）。

---

## 4. 新增一種審批類型

1. `modules/approval/approval.constants.ts` 的 `ApprovalType` 加一個值
   （OpenAPI 的 `ApprovalType` 會跟著變，前端 `APPROVAL_TYPE_LABEL_KEY` 的 `satisfies` 會編譯失敗提醒補語系）。
2. 在 **擁有該資源的模組** 實作 `ApprovalHandler`（`modules/approval/approval.types.ts`）：

   | 方法                    | 責任                                                     |
   | ----------------------- | -------------------------------------------------------- |
   | `requiredPermissions()` | 核准還需要的權限（等同直接執行該操作所需的權限）         |
   | `assertApprovable()`    | 交易前的業務檢查，與直接執行該操作的檢查相同             |
   | `apply(ctx, tx)`        | 在同一個交易內套用變更，含該變更自己的稽核               |
   | `afterApply()`          | 交易提交後的快取失效與領域事件                           |
   | `summarize(payload)`    | 站內通知用的一行摘要（名稱快照，例：資料夾名稱）         |
   | `resultLink?(request)`  | 審批結果通知的連結（前端 route id）；不提供時連到審批詳情 |

3. handler 在 `onModuleInit` 呼叫 `ApprovalService.registerHandler(this)`；該模組 import `ApprovalModule`。
   `ApprovalModule` 是葉節點，不認識任何業務模組（沒有循環依賴）。
4. 提供送出請求的入口（例：`userRegistrationRequest()` 產生 `SubmitApprovalInput`），
   由呼叫端的 service 呼叫 `ApprovalService.submit()`。
5. 前端：`features/approval/constants.ts` 加類型的語系鍵（`APPROVAL_TYPE_LABEL_KEY`、`APPROVAL_TYPES`）與核准的結果句
   （`APPROVAL_OUTCOME_KEY`，§11.3）；`pages/ApprovalDetail/adapter.ts` 把該類型的 `payload` 收斂成 view model、
   `outcomeParams()` 取出結果句的參數；需要額外權限時擴充 `useApprovalReviewAccess()`。申請人是登入者的類型，
   提供「修改後重新送出」的入口（擁有者 feature 登記 route id，詳情的 `ApprovalStatusBanner` 連過去；§11.3）。
6. 要支援多階段流程時，handler 宣告 `flow`（申請人是登入者或匿名、條件可用的欄位，§9.1）；前端的流程設定頁
   （`features/approval-flow`）加上類型與欄位的語系。
7. 更新本文件 §5 之後的類型章節、§8（API）。

---

## 5. `user.register` — 註冊

### 5.1 流程

```
申請人（未登入）                     API                                   管理員
  │ POST /auth/register ─────────────▶│ 只允許 SSO 的網域？→ 403 AUTH_SSO_REQUIRED
  │ { email, displayName, reason? }   │ email 已是使用者？→ 不建立請求
  │                                   │ 同 email 已有待審？→ 不建立請求
  │                                   │ 否則建立 user.register（pending）
  │◀──── 202 { submitted: true } ─────│ 推播 approval create ──────────────▶│ 列表更新
  │                                   │                                     │
  │                                   │◀── POST /approvals/:id/approve ─────│ { roleIds?, comment? }
  │                                   │ 建立 status=pending、沒有密碼的帳號
  │                                   │ 指派角色、清空 private_payload、入列啟用信
  │◀──── 啟用信（寄到申請的 email）───│
  │ POST /auth/setup { token, password } ─▶│ pending → active
  │ POST /auth/login ────────────────▶│
  │◀──── 200（可以登入）──────────────│
```

### 5.2 規則

| 規則                                                             | 理由                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 回應永遠是 `202 { submitted: true }`，不透露 email 是否已存在    | 帳號列舉防護（同 `forgot-password`）                            |
| 已存在的使用者、已在審核中的 email 都不建立新請求                | 避免重複；去重不分大小寫（`users.email` 是 citext）             |
| 申請時不設密碼（舊的用戶端送來的 `password` 會被忽略）           | 申請時的密碼從來沒有證明過 email 的所有權，存著只是多一份要保護的秘密；密碼一律在啟用信的連結裡設定 |
| 核准後帳號是 `pending`、沒有密碼，寄啟用信；從信中連結設定密碼後才是 `active` | 申請時沒有驗證 email：任何人都能用別人的 email 申請，審核者看到熟悉的名字就核准（審批頁在 email 旁標示「尚未驗證」）。收得到信才證明擁有這個 email。啟用前沒有密碼，登入一律 `AUTH_INVALID_CREDENTIALS` |
| 只允許 SSO 的網域不接受申請（`403 AUTH_SSO_REQUIRED`，不建立請求） | 那些帳號應由外部 IdP 建立或連結；與密碼登入的回應相同，不多透露什麼 |
| 核准或駁回都寄信通知申請人（`approval.resultMail`，審核的交易內入列） | 申請人不必一直試著登入才知道結果；駁回時附上審核意見           |
| 申請後 email 被管理員直接建立 → 核准回 `409 USER_EMAIL_DUPLICATE`，請求保持 `pending` | 由審核者決定駁回；不自動改狀態                       |
| 核准前登入 → `401 AUTH_INVALID_CREDENTIALS`（帳號不存在）        | 不另外提示「審核中」，同樣是帳號列舉防護                       |
| 速率限制：同一個 email ＋ IP 每分鐘 `max(3, AUTH_RATE_LIMIT / 3)` 次，同 IP 另有總上限 | 每一筆都會進管理員的待審清單                                   |

### 5.3 稽核

| action             | actor                        | 內容                                              |
| ------------------ | ---------------------------- | ------------------------------------------------- |
| `approval.submit`  | 申請人 email（`actorId = null`） | `payload`（不含密碼雜湊）                     |
| `approval.approve` | 審核者                       | 意見、指派的角色、`resultResourceId`              |
| `user.create`      | 審核者                       | 同一般建立使用者；`metadata.approvalId`           |
| `approval.reject`  | 審核者                       | 意見                                              |

---

## 6. 前端

| 項目       | 位置                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- |
| 申請帳號頁 | apps/platform 的 `/register?tenant=<代碼>`（未登入可進；登入頁有連結）。租戶關閉註冊（`auth.registrationEnabled`）時登入頁不顯示連結、申請頁顯示不開放 |
| 審批列表   | `/approval`，Page Key `APPROVAL`（`approval:read`），選單「審批」（帶待審數）；預設只看待審，上方是狀態的分段切換；多關請求多一欄「進度」（§9.16、§11.2） |
| 我的審批   | `/my-approvals`，Page Key `MY_APPROVAL`（不需要權限）：待我審核、我的申請（§9.16）       |
| 審批詳情   | `/approval/$approvalId`、`/my-approvals/$approvalId`：整頁（§11.3）。狀態橫幅、申請內容與留言、審核流程、這個人能做的操作（角色可搜尋多選、審核意見、核准／駁回） |
| 快速審核   | 列表「操作」欄：待審列的 ✓ 核准／✗ 駁回，確認後直接送出。**不指派角色、不附意見**；要指派角色改開對話框。沒有 `approval:review` 時整欄不出現；缺類型要求的權限時核准鈕停用並說明原因 |
| 批次審核   | 勾選後的批次操作列：核准／駁回，語意同快速審核（`useApprovalBatchActions`、`features/approval/batch.ts`）。只送出待審的列，核准另需類型要求的權限；送進全域佇列逐筆呼叫單筆的核准／駁回端點，進度與結果見 [`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §6.2 |
| 權限 facade | `useApprovalPermission()`：`canReview`、`canApproveRegistration`、`canAssignRole`        |
| 可見性     | `useApprovalReviewAccess()`：未水合／無 `approval:review`／已審核 → 不顯示審核操作       |
| 快取       | `approval` 資源（`APPROVAL_LIST` ／ `APPROVAL_DETAIL`）；核准註冊另宣告 `user` create    |
| E2E        | `apps/e2e/tests/approval.spec.ts`：申請 → 從待審清單打開詳情、核准並指派角色（之後前往下一筆或回到列表） → 啟用前登入被擋 → 從 Mailpit 的啟用信設定密碼 → 登入；快速審核；auditor 唯讀、member 403 |
| E2E（多階段） | 同一個檔案（與單關的案例依序執行）：兩關的註冊申請依序同意後定案；流程編輯頁加一關（指定使用者、條件）並調整順序 → 試算 → 儲存；auditor 唯讀、member 403 |

---

## 7. `fileFolder.access` — 申請資料夾存取

規格見 [`iam/06-resource-grants.md`](../iam/06-resource-grants.md) §6.5；handler 在
`apps/api/src/modules/file/file-folder-access.approval.ts`。

| 項目 | 內容 |
| --- | --- |
| 申請人 | 登入者（`requester_id` 是本人，四眼原則適用） |
| `subject_key` | `<folderId>:<userId>`：同一個人對同一個資料夾同時只有一筆待審 |
| `payload` | `{ folderId, folderName, level }`（申請的等級） |
| `requiredPermissions()` | 無：審核權限是資源層級的，改在 `assertApprovable()` 檢查 |
| `assertApprovable()` | 資料夾還在、申請人還在、審核者在該資料夾 `share` 且授予得起該等級（反提權） |
| `apply()` | 對申請人寫入（或提高到）申請的等級；`fileFolder.grant` 稽核帶 `metadata.approvalId` |
| 審核入口 | 審批頁（`approval:review`），或檔案管理器的共用對話框（資料夾的管理者，不需要 `approval:*`） |

---

## 8. API

| Method | Path                     | 授權                                    | 說明                         |
| ------ | ------------------------ | --------------------------------------- | ---------------------------- |
| GET    | `/approvals`             | 🔑 登入；`scope=all` 另要 `approval:read` | 列表（分頁／篩選／排序；`scope`，§9.13） |
| GET    | `/approvals/counts`      | 🔑 登入                                 | 待審數 `{ assigned, pending }`：`pending` 只給 `approval:read`（沒有時為 null，不寫 `authz.denied`；§11.1） |
| GET    | `/approvals/:id`         | 🔑 登入；可見性見 §9.10                 | 詳情（含關卡與 `viewer`）    |
| POST   | `/approvals/:id/approve` | 🛡 `approval:review` ＋ 類型要求的權限   | 單關的核准並套用變更         |
| POST   | `/approvals/:id/reject`  | 🛡 `approval:review`                    | 單關的駁回                   |
| POST   | `/approvals/:id/withdraw`, `…/steps/:ordinal/*` | 見 §9.13            | 撤回、多階段的關卡操作       |

**`GET /approvals` Query**

| 參數               | 說明                                                          |
| ------------------ | ------------------------------------------------------------- |
| `scope`            | `all`（預設）／`assigned`（待我審核）／`mine`（我送出的），§9.13 |
| `offset` / `limit` | 分頁                                                          |
| `keyword`          | 申請人名稱（註冊 = email）部分比對                            |
| `status`           | `pending` / `approved` / `rejected` / `withdrawn`，可重複     |
| `type`             | `user.register`，可重複                                       |
| `sort`             | `createdAt` / `reviewedAt`，`-` 前綴為降冪；預設 `-createdAt` |

**`POST /approvals/:id/approve`**

```jsonc
// Request（皆可省略）
{ "comment": "歡迎", "roleIds": ["uuid"] }   // roleIds 只對 user.register 有意義
```

回應為更新後的 `ApprovalRequest`（`status = approved`、`resultResourceId` = 新使用者 id）。
`private_payload` 永遠不會出現在任何回應中。

**`POST /approvals/:id/reject`**：`{ "comment"?: string }`，回應同上（`status = rejected`）。

| 錯誤                          | 時機                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `404 APPROVAL_NOT_FOUND`      | id 不存在                                                       |
| `409 APPROVAL_ALREADY_REVIEWED` | 已被審核過（含兩位審核者同時送出時較晚的那位）                |
| `403 APPROVAL_SELF_REVIEW`    | 審核自己送出的請求                                              |
| `403 AUTHZ_FORBIDDEN`         | 缺少類型要求的權限（`details.missing`）                         |
| `403 AUTHZ_ESCALATION`        | 指派的角色超出審核者的權限                                      |
| `409 USER_EMAIL_DUPLICATE`    | `user.register`：申請後該 email 已被建立（請改為駁回）          |

**批次**：沒有批次端點，由前端逐筆呼叫單筆 API，見 [`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13。

**站內通知**（[`15-notification.md`](./15-notification.md)）：送出請求時，送出當下持有 `approval:review` 的人（不含申請人自己）各收到一則 `approval.pending`；
核准或駁回時申請人收到 `approval.result`（匿名的註冊沒有收件人，只有結果信）。都與審批的寫入在同一個交易。

`approval.result` 的連結預設指向「我的審批」的詳情（`approval.myDetail`）：申請人通常沒有 `approval:read`。

---

## 9. 多階段審批

一種審批類型可以設定 **流程**：依序的多個關卡，每一關有自己的審核者與同意數，關卡可以帶條件。
沒有流程、或 `approvalChain` 未啟用時，請求照舊是單關（§3）。決定與理由見 §10。

| 名詞 | 意思 |
| --- | --- |
| 流程（flow） | 一種審批類型的關卡設定；一個類型最多一個，存在 `approval_flows` |
| 關卡（step） | 流程裡的一關；送出時複製一份成為請求的 `approval_steps`（快照） |
| 審核者規則（assignee） | 關卡要找誰：`user`／`group`／`role`／`manager`／`orgUnit` |
| 候選人（candidate） | 關卡 **啟動** 時依規則展開、再扣掉不合格者的人，落地在 `approval_step_assignees` |
| 短缺（shortage） | 候選人為 0（`noCandidate`）或少於要求的同意數（`insufficient`） |
| 單關請求 | `current_step IS NULL`：沒有流程、送出時 `approvalChain` 未啟用、或關卡全部略過 |

### 9.1 Handler 的宣告

`ApprovalHandler` 多一個選用的 `flow`（`modules/approval/approval.types.ts`）；沒有宣告的類型永遠單關（D18）：

```ts
interface ApprovalFlowSupport {
  /** 匿名的類型（註冊）不能用 `manager` 規則：沒有申請人可以往上找。 */
  requester: 'user' | 'anonymous';
  /** 條件可以用的欄位；值由 handler 從 payload 取出。 */
  fields: ApprovalConditionField[]; // { key, type: 'number' | 'string' | 'enum', options?, read(payload) }
}
```

| 類型 | `flow` | 欄位 |
| --- | --- | --- |
| `user.register` | 匿名 | `emailDomain`（字串，email 的網域，小寫） |
| `fileFolder.access` | 不宣告：審核資格是資源層級的（資料夾的 `share`），另一條審核入口在檔案管理器 | — |

`requiredPermissions()` 收到的是 `{ request: ApprovalRequestRow | null, options }`（`ApprovalPermissionContext`）：
關卡啟動時以它篩選最後一關的候選人，設定流程時以它做反提權（那時沒有請求）。

整合測試另外註冊一個只在測試裡存在的類型 `test.purchase`（欄位 `amount`、`category`）驗證完整的分流（`apps/api/test/approval-chain.spec.ts`）。

### 9.2 審核者規則（可登記，D15）

規則的種類由擁有者模組登記（`ApprovalService.registerAssigneeResolver()`，`ApprovalAssigneeRegistry`）；`modules/approval` 不 import 它們。

| kind | 登記者 | 展開 |
| --- | --- | --- |
| `user` | approval（`approval-assignee.resolvers.ts`） | 該使用者 |
| `group` | approval（經 `AuthzService.usersInSubjectSets`） | 群組（含巢狀）的成員；`group` feature 停用時成員關係暫停 → 空 |
| `role` | approval（經 `PermissionService.findUserIdsHoldingRole`） | 角色的持有者（直接 ＋ 經由群組；群組停用時只有直接持有） |
| `manager` | organization（`org-assignee.resolvers.ts`） | 申請人的第 `level`（1–5）層主管（[`23-organization.md`](./23-organization.md) §3） |
| `orgUnit` | organization | 某部門的主管 |

每個解析器有 `isAvailable()`（流程編輯與試算用；`manager`／`orgUnit` 看 `organization`、`group` 看 `group`）與 `describe()`（對象的顯示名稱、是否已刪除）。
沒有登記或不可用的種類展開為空陣列，不拋錯。

### 9.3 資料模型（租戶 DB，migration 0047）

| 表 | 內容 |
| --- | --- |
| `approval_flows` | `type`（唯一）、`enabled`、`allow_repeat_approver`、`steps`（jsonb：`[{ key, name, assignee, requiredApprovals, conditions }]`，zod 驗證）、`version`。停用保留設定；重設刪掉這一列（§12 D10），已送出的請求帶著關卡的快照與 `flow_version` 照舊走完 |
| `approval_requests`（新增欄位） | `flow_id`、`flow_version`、`allow_repeat_approver`（送出時的快照）、`current_step`、`resubmitted_from`；`status` 多 `withdrawn` |
| `approval_steps` | 送出時從流程複製：`ordinal`、`key`、`name`、`assignee`（規則 ＋ 送出當下的顯示名稱 `label`）、`required_mode`（`count`／`all`）、`required_approvals`（`all` 在啟動時填入候選人數）、`conditions`、`status`（`waiting`／`active`／`approved`／`rejected`／`skipped`／`cancelled`）、`shortage`、`close_reason`（`rejected`／`withdrawn`／`chainDisabled`／`override`）。`UNIQUE (request_id) WHERE status = 'active'`：同時只有一個進行中的關卡 |
| `approval_step_assignees` | 啟動時展開的候選人（`added_by`：`activation`／`refresh`）；冗餘 `request_id` 給「待我審核」 |
| `approval_decisions` | 每個人在每一關的決定：`decision`、`via`（`assignee`／`override`／`legacy`）、意見、名稱快照；`UNIQUE (step_id, reviewer_id)` |

流程的限制：最多 10 關、每關最多 5 個條件、同意數 1–20、`in` 最多 50 個值、`manager` 層數 1–5。

### 9.4 狀態機

```
 關卡：送出時 條件不符 ─▶ skipped
             其他    ─▶ waiting ──輪到它（activate）──▶ active ──同意數達到／override 核准──▶ approved
                                                         ├──任一人駁回／override 駁回 ────▶ rejected
                        waiting／active ──請求被駁回、撤回、停用期間單關定案──▶ cancelled
```

請求在最後一關達到同意數時才進入 §3.4 的核准（`handler.apply`）；任一關有人駁回即整筆駁回。

### 9.5 送出

`ApprovalService.submit()`：handler 宣告了 `flow`、`approvalChain` 已啟用、該類型有啟用中的流程 → 走流程；否則單關。走流程時在送出的交易內：

1. 寫入請求（`flow_id`、`flow_version`、`allow_repeat_approver`）。
2. 依序複製關卡；以 `flow.fields[].read(payload)` 取值判斷條件，不符合的 `skipped`（條件只在送出時判斷，D2）。
3. **全部略過** → 請求照樣建立、`current_step` 為 null，退回單關（通知 `approval:review` 的持有者）。不自動核准。
4. 啟動第一個 `waiting` 的關卡（§9.6）。
5. 稽核 `approval.submit`（`metadata`：`flowId`、`flowVersion`、`skippedSteps`）。

`approval:review` 與 `approval:override` 的持有者在交易之前查好（會用連線池另取連線）。

### 9.6 關卡的啟動

```
候選人 ← 規則展開 − 申請人（四眼）− 不能審的帳號（停用、刪除、服務帳號）
        − 這筆請求前面關卡做過決定的人（allow_repeat_approver 為 false 時，D6）
最後一個會執行的關卡 → 只留下持有 handler requiredPermissions 的人（D3；交易內逐人以同一個交易查權限）
同意數 ← all ? 候選人數 : required_approvals
短缺   ← 候選人 0 → noCandidate；少於同意數 → insufficient
```

寫入候選人、`status = active`、推進 `current_step`；候選人收到 `approval.pending`（帶關卡名稱）；有短缺時 `approval:override` 的持有者收到 `approval.unassigned`。
候選人在啟動當下展開（D4），之後群組成員或主管異動不會自動改名單。

### 9.7 做出決定（D16）

`POST /approvals/:id/steps/:ordinal/decisions`：

```
BEGIN
  SELECT … FROM approval_requests WHERE id = ? FOR UPDATE      同一筆請求的決定排隊
  ├ 已結束 409 APPROVAL_ALREADY_REVIEWED；current_step ≠ :ordinal 409 APPROVAL_STEP_STALE
  ├ 申請人本人 403 APPROVAL_SELF_REVIEW；不是候選人或帳號不是 active 403 APPROVAL_NOT_ASSIGNED
  ├ 這一關已做過決定 409 APPROVAL_STEP_ALREADY_DECIDED
  ├ reject → 這一關 rejected、其餘 cancelled、請求駁回（ApprovalFinalizer.reject：稽核、結果信、通知、webhook）
  └ approve → 同意數未達 → approval.stepApprove 稽核
              達到、還有下一關 → 這一關 approved、啟動下一關、申請人 approval.progress
              達到、最後一關 → requiredPermissions（assertHasAll，帶 tx）＋ assertApprovable，都在鎖之內
                              → ApprovalFinalizer.approve（與單關同一段：handler.apply、結果、稽核、結果信、通知、webhook）
COMMIT → 最後一關才 handler.afterApply → 推播
```

`ApprovalFinalizer` 是單關、多階段最後一關、停用期間單關定案共用的最終核准／駁回（交易內的順序只有一份）。
多階段的決定目前不帶 `roleIds`（`user.register` 走流程時，核准後到使用者頁指派角色）。

### 9.8 卡住時：`approval:override`（D9、D10）

| 動作 | 端點 | 做什麼 |
| --- | --- | --- |
| 重新展開審核者 | `POST /approvals/:id/steps/:ordinal/refresh` | 依快照的規則重新解析，只增不減；新加入的人收到 `approval.pending`；重新計算短缺。稽核 `approval.stepRefresh` |
| 強制定案 | `POST /approvals/:id/steps/:ordinal/override` `{ decision, comment }` | 意見必填。核准 → 這一關 approved（`close_reason = override`）往下一關；駁回 → 整筆駁回。四眼照舊；最後一關的核准照舊要 handler 的權限。稽核 `approval.override` |

### 9.9 申請人

- 申請人看得到自己送出的請求（不需要 `approval:read`），包括關卡進度與意見。
- `POST /approvals/:id/withdraw`：只有申請人（`403 APPROVAL_NOT_REQUESTER`；看不到的人 `404`）、只限 `pending`。
  多關的剩餘關卡 `cancelled`（`withdrawn`）。稽核 `approval.withdraw`。單關請求也能撤回。
- 重新送出是新的一筆：`SubmitApprovalInput.resubmittedFrom` 指向前一筆（D7）。

### 9.10 可見性

| 誰 | 看得到 |
| --- | --- |
| `approval:read`（`approval:override` 包含它） | 全部 |
| 申請人 | 自己送出的 |
| 候選人 | 自己曾經是候選人的請求（任一關，含已結束的） |

看不到的人 `GET /approvals/:id` 回 `404 APPROVAL_NOT_FOUND`。詳情的 `viewer`：`canDecide`、`canOverride`、`canReviewSingle`、`canWithdraw`，前端依它顯示操作。

### 9.11 平台關閉 `approvalChain`（D12、D13）

| | 停用時 | 照舊 |
| --- | --- | --- |
| 流程設定 | `/approval-flows` 回 `404 FEATURE_DISABLED`；系統設定沒有「審批流程」分頁 | 流程保留 |
| 新的申請 | 一律單關 | — |
| 進行中的多關請求 | 關卡的決定、override、refresh 回 404；改由 `POST /approvals/:id/approve`／`reject` 一次定案，目前與之後的關卡 `cancelled`（`chainDisabled`），目前那一關記一筆 `via = legacy` 的決定；稽核 `metadata.chainDisabled = true` | 已做出的決定 |
| 我的審批 | 沒有「待我審核」；`scope=assigned` 回空 | 我的申請與撤回 |
| 詳情、列表 | 進行中的多關請求照單關顯示（`withoutChain`）：沒有目前與之後的關卡、候選人、同意數與「找不到審核者」，列表的「進度」是空的；已做出的決定照樣列在時間軸，停用期間定案的標記（`legacy`、`chainDisabled`）不顯示 | 已做出的決定 |
| 通知 | `approval.progress`、`approval.unassigned` 不送（通知類型的 `feature`） | `approval.result` |
| 重新啟用 | 停用期間沒有定案的請求從原本的關卡繼續；候選人沿用當時的名單 | — |

`TenantFeatureImpacts`：`approvalFlows`（啟用中的流程數）、`approvalRequestsInChain`（進行中的多關請求數）；
`organization` 的確認框另列 `approvalFlowsUsingOrg`（用到 `manager`／`orgUnit` 的啟用中流程數）。新租戶與既有租戶預設都啟用（D17，平台 migration 0022）。

### 9.12 組織、群組被關閉時（D14）

| 被關閉 | 影響 |
| --- | --- |
| `organization` | `manager`／`orgUnit` 展開為空 → `noCandidate` → override。流程編輯：新增或修改用到它們的關卡回 `422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE`（`details.steps`）；沒改到的關卡不擋 |
| `group` | `group` 展開為空；`role` 只剩直接持有的人。流程編輯同上 |
| 規則指到的對象被刪除 | 同「展開為空」；流程編輯擋新增或修改指到已刪除對象的關卡 |

不做平台層的 feature 相依。

### 9.13 API

| Method | Path | 授權 | 說明 |
| --- | --- | --- | --- |
| POST | `/approvals/:id/withdraw` | 🔑 登入，申請人本人 | §9.9 |
| POST | `/approvals/:id/steps/:ordinal/decisions` | 🔑 登入 ＋ `approvalChain`；service 檢查候選人 | `{ decision, comment?, roleIds? }`，§9.7 |
| POST | `/approvals/:id/steps/:ordinal/refresh` | 🛡 `approval:override` ＋ `approvalChain` | §9.8 |
| POST | `/approvals/:id/steps/:ordinal/override` | 🛡 `approval:override` ＋ `approvalChain` | `{ decision, comment }`，§9.8 |
| GET | `/approval-flows` | 🛡 `approvalFlow:read` ＋ `approvalChain` | 支援流程的類型（各帶欄位定義、流程）、`assigneeKinds`（各種規則能不能用） |
| GET | `/approval-flows/:type` | 🛡 `approvalFlow:read` ＋ `approvalChain` | 流程；每一關帶 `assigneeStatus`（名稱、`available`、`deleted`）。另帶欄位的 `example`（試算的預設值）、`requiredPermissions`（核准所需的權限與顯示名稱的語系鍵，最後一關的說明用）、`inFlightCount`（照這個流程送出、還在審的筆數） |
| GET | `/approval-flows/:type/stats` | 🛡 `approvalFlow:read` ＋ `approvalChain` | 實際運作：近 30 天送出的請求依狀態計數、定案的平均小時數；目前所有進行中的請求停在哪一關（依關卡名稱，含短缺的筆數）。開頁時即時彙總（§12 D9） |
| DELETE | `/approval-flows/:type?version=` | 🛡 `approvalFlow:update` ＋ `approvalChain` | 重設成未設定：刪掉流程，這個類型回到單關審批。版本不符 `409 APPROVAL_FLOW_VERSION_CONFLICT`、反提權同 PUT；已經沒有流程時 204。稽核 `approvalFlow.reset`（`before` 是整份流程） |
| PUT | `/approval-flows/:type` | 🛡 `approvalFlow:update` ＋ `approvalChain` | 建立或取代；修改帶 `version`（`409 APPROVAL_FLOW_VERSION_CONFLICT`）；不支援的類型 `422 APPROVAL_FLOW_NOT_SUPPORTED`；內容與 handler 的宣告不符 `400 VALIDATION_FAILED`（`fields["steps.1.conditions.0.op"]`）；反提權（D11） |
| POST | `/approval-flows/:type/preview` | 🛡 `approvalFlow:read` ＋ `approvalChain` | 試算：`{ steps?（草稿）, requesterId?, fields }` → 每一關略過與否、候選人、同意數、短缺。與 §9.6 共用解析，沒有前面的決定 |

`GET /approvals` 的 `scope`：`all`（`approval:read`）、`assigned`（我是目前關卡的候選人、還沒決定）、`mine`（我送出的）。
列表的每一列多帶 `currentStep`（`ordinal`、`name`、`approvals`、`required`、`shortage`，以及 `activatedAt`、還沒決定的候選人
`pendingReviewers`（依名稱的前 3 位）與 `pendingCount`，§11.2）、`stepCount`、`flowVersion`、`resubmittedFrom`。
詳情另帶 `resubmittedTo`：申請人以它為前一筆重新送出的最新一筆（§11.3）。

### 9.14 權限

| 權限鍵 | 說明 | 預設角色 |
| --- | --- | --- |
| `approval:override` | 重新展開審核者、強制定案目前的關卡（包含 `approval:read`） | super-admin、admin |
| `approvalFlow:read` | 流程設定、試算 | super-admin、admin、auditor |
| `approvalFlow:update` | 設定流程；受反提權限制（[`iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §9.2 G4） | super-admin、admin |
| `approval:export` | 匯出請求與每一關的決定（包含 `approval:read`；[`22-data-transfer.md`](./22-data-transfer.md) §12.5） | super-admin、admin、auditor |

關卡的審核 **不需要** `approval:review`：被流程指派就是授權（D3）。

### 9.15 通知、推播、稽核

| 通知 | 收件人 | 時機 |
| --- | --- | --- |
| `approval.pending`（`params.stepName`） | 多關：那一關的候選人 | 關卡啟動、refresh 新加入的人 |
| `approval.progress`（`feature: approvalChain`） | 申請人 | 一關通過、往下一關 |
| `approval.unassigned`（`feature: approvalChain`） | `approval:override` 的持有者（不含申請人） | 關卡啟動時短缺 |

多關的通知連到 `approval.myDetail`（`/my-approvals/$approvalId`）。推播 `approval` 的受眾：`approval:read` 的 perm room ＋ 申請人 ＋ 相關候選人的 user room；
流程的變更推 `approvalFlow`（`approvalFlow:read`）。稽核：`approval.stepApprove`／`stepReject`／`stepRefresh`／`override`／`withdraw`、`approvalFlow.update`（`before`／`after` 是整份流程）。
Webhook 不變：只有最終的 `approval.decided`。

### 9.16 前端

| 位置 | 內容 |
| --- | --- |
| 審批頁（`features/approval`） | 側欄「人員管理」。列表多一欄「進度」（`財務 1／2`、等待誰、多久，短缺時標示）；進行中的多關請求不能快速／批次審核（`approvalChain` 停用時可以）。整頁的詳情 `ApprovalDetailView`（§11.3）：審核流程 `ApprovalTimeline` 逐人列出決定、依 `viewer` 顯示關卡的同意／駁回與撤回，強制定案（意見必填）與重新展開在「管理員操作」 |
| 我的審批 | `/my-approvals`（Page Key `MY_APPROVAL`，不需要權限，側欄「人員管理」，排在「審批」之後）：「待我審核」（`approvalChain` 已安裝時才有）、「我的申請」；詳情 `/my-approvals/$approvalId`（route id `approval.myDetail`） |
| 流程設定（`features/approval-flow`，可啟用的 feature `approvalChain`） | 系統設定的「審批流程」分頁 `/system/approval-flows`（Page Key `APPROVAL_FLOW`，`approvalFlow:read`；側欄沒有另外的入口，[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §4.5）：每個支援流程的類型一張卡片，寫明目前的審批方式——沒有流程是「單關審批」（照常運作，不是空白的欄位）、啟用中列出依序的關卡、停用時說明回到單關並列出保留的關卡——另有版本與有無不可用的規則；動作鈕依權限是「設定流程」／「編輯流程」或「檢視」。卡片另有一行實際運作（近 30 天送出、進行中，找不到審核者時標示）。`/system/approval-flows/$type`：整頁編輯（仍在系統設定的外框裡）。還沒有流程而且能編輯時先選範本（`templates.ts`：申請人的主管、主管 → 指定角色、指定角色的任一人、初審 → 複審、從空白開始；匿名的類型不列出主管，規則不能用的不列出），範本只產生草稿。左邊是整條流程的摘要（申請 → 每一關的審核者、同意數、條件數 → 核准後；點節點展開那一關），開關，與關卡卡片：已儲存的收合成一行、還沒儲存的與有錯誤的展開，上移／下移、規則、同意數（附「任 M 人」與會簽的說明）、條件列；最後一關說明審核者還要有 `requiredPermissions`（D3）。右邊是試算與實際運作：試算以欄位的 `example` 預填，草稿、申請人或欄位值停止變動 500ms 後自動送出（草稿不完整時不送），結果另疊在摘要上（略過虛線、短缺紅框、幾位審核者）。儲存前說明影響：有 `inFlightCount` 時「進行中的 N 筆照送出時的版本」、停用或第一次啟用時說明新申請怎麼審；儲存成功後回到「審批流程」分頁。已有流程時另有「重設流程」：確認後刪掉流程（`DELETE`），回到單關審批與分頁，下次設定從範本開始。「放棄修改」只丟掉這次未儲存的修改。沒有 `approvalFlow:update` 時唯讀但可試算。不能用的規則種類（組織管理、群組沒有啟用）不列在種類選單；已儲存的規則用到它時保留那一個並標示「不會指派任何人」，不提 feature 未啟用（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §7）；指到已刪除的對象標示「已刪除」；`422` 指到的關卡標紅、`VALIDATION_FAILED` 對到欄位、`409` 提示重新載入。類型與條件欄位的顯示名稱在 feature 的語系裡（後端只給 key） |
| 通知 | `approval.pending` 帶關卡名稱時換句子；`approval.progress`、`approval.unassigned` 的句子與事件管理的說明 |

### 9.17 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 `approval-flow.rules.spec.ts` | 條件判斷（每個運算子、取不到值）、流程驗證 |
| 單元 `approval.service.spec.ts` | 單關的行為不變（多階段的部分以假物件代替） |
| 整合 `test/approval-chain.spec.ts` | `test.purchase` 的完整流程、會簽、並行的兩個同意只推進一次、最後一關的權限篩選、D6、短缺與 refresh／override、撤回、可見性、流程的驗證與反提權、試算、`approvalChain`／`organization`／`group` 停用 |
| 前端 | 時間軸、關卡操作的 gating、我的審批的分頁、列表的進度與快速審核的條件、流程設定頁（`features/approval-flow/**/__tests__`） |

---

## 10. 設計決策：多階段審批

> 2026-10-08 決定並實作（原 `docs/features/approval-chains.md`）。延伸 §1 原本「不做」的多階段審批；審核者「主管」由
> [`23-organization.md`](./23-organization.md) 提供。

### 10.1 背景

審批原本是一關：持有 `approval:review`（與 handler 要求的權限）的任何一個人都能定案。B2B 的業務功能幾乎都需要依序多關、會簽與條件分流；
若由每個業務模組自己做，狀態機、四眼原則、通知、稽核都會各寫一份。另外兩個前提：多階段要能被平台關閉，它依賴的組織管理與群組也各自可以被關閉。

### 10.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **流程由租戶在畫面上設定（每類型最多一個）；handler 以 `flow` 宣告支援與條件欄位** | 「誰簽」是租戶的組織決定；「能依什麼分流」是資料的語意，只有 handler 知道 |
| D2 | **條件只在送出時判斷**，欄位 ＋ 運算子 ＋ 值的 AND；取不到值時不成立；全部略過退回單關 | payload 送出後不變，詳情能完整顯示路徑；條件寫錯不會變成沒人審 |
| D3 | **被流程指派即可審，不需要 `approval:review`**；最後一關的候選人只留下持有 handler 權限的人，定案時再檢查一次 | 主管不該為了審自己部門的申請而看到全公司的審批；「核准等同代為執行」由最後一關守住 |
| D4 | **規則在送出時快照、人在關卡啟動時展開並落地**；名單更新靠 refresh（只增不減） | 通知的收件人與可審的人是同一群；「待我審核」可以用索引查 |
| D5 | **會簽：`count`（M 人）或 `all`；任一人駁回即整筆駁回** | 最常見的兩種 |
| D6 | **同一個人在一筆請求只能做一次決定**，除非流程允許；啟動時排除前面做過決定的人 | 多關的意義是多雙眼睛；短缺在啟動當下就看得到 |
| D7 | **駁回、撤回後重送是新的請求**；申請人可以撤回 | 狀態機維持單向；多關讓請求活得更久 |
| D8 | **可見性是請求層級的**：申請人、候選人看得到自己相關的請求；新增「我的審批」 | 同 D3；與 `fileFolder.access` 由資料夾管理者審核的先例一致 |
| D9 | **短缺時不自動處理**：通知 `approval:override` 的持有者 | 任何自動處理都等於在租戶不知情下放寬控制 |
| D10 | **`approval:override`：重新展開、逐關強制定案**（意見必填、四眼、最後一關仍要 handler 的權限） | 審核者離職、部門被刪、feature 被關都會讓關卡卡住，需要一個有紀錄的出口 |
| D11 | **`approvalFlow:update` 受反提權限制**：設定流程的人要持有該類型 handler 的 `requiredPermissions`（不含依選項而定的部分） | 能設定流程的人能決定誰可以代為執行某操作 |
| D12 | **`approvalChain` 可由平台關閉；審批本身常駐**。停用時新申請單關、進行中的以單關端點一次定案 | 資料保留、重新打開後一致；凍結會讓降級的租戶處理不了進行中的申請 |
| D13 | **重新啟用後未定案的請求從原關卡繼續** | 停用期間沒有改動關卡資料 |
| D14 | **不做平台層的 feature 相依**；組織、群組停用時規則展開為空 → 短缺 → override；流程編輯只擋新增或修改 | 組織架構本來就可能不完整，「找不到人」必須有處理方式 |
| D15 | **審核者規則的種類由擁有者模組登記** | 通用模組不 import 業務模組（[`coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2） |
| D16 | **同一筆請求的決定以 `SELECT … FOR UPDATE` 排隊**；「是不是最後一關」與最後一關的權限檢查都在鎖之內 | 會簽時兩個人同時同意，只能推進一次、只能執行一次 `handler.apply` |
| D17 | ~~**新 feature 預設不啟用**（新租戶與既有租戶）~~ **2026-10-08 改為預設啟用**（平台 DB 的預設值加上 `approvalChain`，既有租戶由平台 migration 0022 啟用） | 原理由：全新的加值能力，合併後所有租戶的行為不變。改的理由（使用者決定）：與其他 feature 一致，需要時由平台個別關閉；沒有設定流程的類型照舊單關，打開本身不改變任何審批的行為 |
| D18 | **handler 沒有宣告 `flow` 的類型永遠單關**；`fileFolder.access` 不宣告 | 資源層級審核的類型若再疊上流程，會出現兩條互相矛盾的審核入口 |

### 10.3 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 關卡完全由 handler 的程式決定（`steps(payload)`） | 租戶每換一個簽核主管就要改程式；保留為「能依什麼分流」的宣告（D1） |
| 條件用運算式語言（JSONLogic、CEL） | 能力過剩、難以在畫面上編輯與驗證 |
| 候選人在定案時即時展開 | 資格會在審到一半時改變，「待我審核」也查不了索引（D4） |
| 短缺時自動退回 `approval:review` 的持有者 | 等於讓關卡的指派失效（D9） |
| `approvalChain` 停用時凍結進行中的請求 | 降級的租戶處理不了（D12） |
| 平台層的 feature 相依（`approvalChain` 需要 `organization`） | 讓「只用群組與角色的審批鏈」無法存在（D14） |
| 關卡另開 `approval_flow_steps` 表 | 流程是一次讀寫的整份設定，jsonb ＋ zod 驗證就夠 |

### 10.4 實作紀錄

| 項目 | 補充 |
| --- | --- |
| 最終的核准與駁回 | 抽成 `ApprovalFinalizer`：單關、多階段最後一關、停用期間的單關定案共用交易內的順序 |
| 流程的版本歷史 | 提案寫了以 `RevisionService` 記錄並可還原到某一版；**沒有做**。`approvalFlow.update` 稽核帶整份流程的前後，`version` 做樂觀鎖。需要時再加 |
| 最後一關的權限 | 以 `assertHasAll(…, { tx })` 在鎖之內檢查（拒絕時照樣寫 `authz.denied`），不另算缺少的權限 |
| `approval.result` 的連結 | 預設改連「我的審批」（`approval.myDetail`）：申請人通常沒有 `approval:read` |
| 多階段的 `roleIds` | 關卡端點接受 `roleIds`，前端的關卡操作不送（註冊走流程時，核准後到使用者頁指派角色） |
| `approval:override` 的 refresh | refresh 不是審核：持有 `approval:override` 的申請人也能重新展開自己申請的審核者（強制定案仍受四眼限制） |
| 「我的審批」的待審數徽章 | 沒有做：側欄的入口沒有數字 |
| 流程編輯 | 關卡用上移／下移排序（不做拖曳）；試算按按鈕才呼叫；部門規則用一般的下拉（標籤是完整路徑） |

---

## 11. 互動與引導

審核者要知道有事要做、打開一筆就看得到全貌；申請人要知道申請卡在哪裡。決定與理由見 §12。

> 程式碼：前端 `features/approval/`（`hooks/useApprovalCounts.ts`、`home.ts`、`pages/ApprovalDetail/`），
> 側欄徽章在 `web-core/navigation`（`NavItem.useBadge`）、首頁區塊的註冊表在 `apps/backstage/src/core/home/`
> （[`../frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §4.6、§4.7）；後端 `GET /approvals/counts`、
> 列表的 `currentStep` 擴充（`ApprovalChainRepository.summariesOf`）、`approval-comment.resource.ts`。

### 11.1 待辦的入口

| 位置 | 內容 |
| --- | --- |
| 待審數 | `GET /approvals/counts` → `{ assigned, pending }`。`assigned` 同 `scope=assigned` 的總數（停用多階段時 0）；`pending` 是全部的待審，只給 `approval:read` |
| 側欄的徽章 | 「我的審批」顯示 `assigned`、「審批」顯示 `pending`。查詢在 `approval` 推播（`collection` 含 `APPROVAL_COUNTS`）與視窗聚焦時重抓 |
| 首頁的「待辦」 | `PendingApprovalsSection`（頁面鍵 `MY_APPROVAL`）：待我審核的筆數與最舊的 3 筆（連到詳情，帶 `queue`）；有 `approval:review` 的人另見全部的待審數。兩者都是 0 時不渲染 |

### 11.2 列表

| 項目 | 內容 |
| --- | --- |
| 預設只看待審 | 網址的 `status` 預設 `pending`（不寫進網址）；上方的分段切換「待審核（N）／已核准／已駁回／已撤回／全部狀態」，「全部」是明確的 `all`。篩選面板只剩申請人、類型、排序 |
| 類型 | 選項由 `APPROVAL_TYPES` 產生（註冊、資料夾存取） |
| 進度欄 | 「財務 1／2」，下一行「等待 王小明、李小華 等 3 人 · 2 天前」；總表與「我的審批」共用 `ApprovalProgress` |
| 空狀態 | 沒有篩選時說明這個狀態為什麼是空的，以及申請從哪裡來（`ApprovalSourcesHint`）；有篩選時照表格的預設（清除篩選）。「我的審批」的兩個分頁各有說明 |
| 「我的審批」的分頁 | 「待我審核（N）」帶 `assigned`，最早送出的在前（待辦的順序；首頁的待辦與詳情的「下一筆」同一個順序）；「我的申請」最新的在前 |

### 11.3 詳情

`/approval/$approvalId` 與 `/my-approvals/$approvalId` 都是整頁（`ApprovalDetailView`，以 `approvalId` 為 key 掛載），網址帶著列表的條件，
「回到列表」還原篩選。版面：

| 區塊 | 內容 |
| --- | --- |
| 狀態橫幅 `ApprovalStatusBanner` | 一句話說明現況（等待第幾關、幾人同意；找不到審核者；單關等待管理員；已核准／已由誰駁回／已撤回）與這個人能做什麼（輪到你審核、可以撤回、可以在管理員操作處理），以及核准的結果句。重新送出的前後筆互相連結 |
| 左欄 | 申請內容（`ApprovalSummary`）、留言（`<ResourcePanels resourceType="approval">`） |
| 右欄：操作 `ApprovalActionPanel` | 只放目前這個人能做的：審核意見與角色、同意／駁回（或單關的核准／駁回）、撤回；`approval:override` 的「管理員操作」另成一段並說明它會略過原本的審核者。什麼都不能做時不渲染 |
| 右欄：審核流程 `ApprovalTimeline` | 縱向節點：送出申請 →（單關的「審核」或每一關）→ 核准後的結果。每一關列出規則、同意數、開始多久，進行中的關卡逐人列出「同意／駁回／尚未動作」與意見；已結束的關卡只列做了決定的人（含強制定案） |

| 行為 | 內容 |
| --- | --- |
| 核准的結果句 | 前端依類型對照（`APPROVAL_OUTCOME_KEY`，`useApprovalOutcome`）：待審時是「核准後會建立帳號 …」，核准後是「已建立帳號 …」 |
| 決定後 | 從待審清單（總表的待審、「待我審核」、首頁的待辦）進來的網址帶 `queue`：定案或關卡的決定成功後，前往同一份清單裡排在後面、仍在清單上的那一筆（`useNextApproval`）；沒有了就回到列表並提示。從通知或網址直接進來的留在原頁，表單清空。撤回一律留在原頁 |
| 留言 | 審批是可留言的資源（[`24-comment.md`](./24-comment.md) §1）：看得到請求就能讀寫留言、@提及、關注，定案後照常可以留言；連結指向「我的審批」的詳情 |
| 修改後重新送出 | 申請人看自己被駁回或撤回、還沒重新送出的申請時出現。`fileFolder.access` 經 route id `file.requestAccess` 回到檔案管理器，打開那個資料夾的申請對話框並預填等級，送出帶 `resubmittedFrom`；`user.register` 是匿名申請，沒有入口。後端在 `ApprovalService.submit()` 驗證前一筆：同類型、同申請人、`rejected`／`withdrawn`，否則 `422 APPROVAL_RESUBMIT_INVALID` |

### 11.4 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 `approval.service.spec.ts` | 重新送出的驗證（每一種不合格的前一筆）、待審數（有無 `approval:read`、停用多階段） |
| 整合 `test/approval-chain.spec.ts` | 列表的未決定候選人與開始時間、待審數、`resubmittedTo`、留言的可見性（定案後仍可留言、看不到 404） |
| 前端 | 側欄徽章（`web-core/layout/__tests__/SideNav.test.tsx`）、首頁區塊的註冊表與待辦、列表的狀態切換與 `queue`、審核流程的逐人狀態、狀態橫幅、詳情的未儲存提醒與「下一筆」、重新送出的預填 |
| E2E | `approval.spec.ts`：從待審清單核准後離開詳情、多階段的逐人狀態；`notification.spec.ts`：通知連到整頁的詳情 |

---

## 12. 設計決策：互動與引導

> 2026-10-10 決定並實作（原 `docs/features/approval-experience.md`）：第 1、2 批是審批頁（§11），第 3 批是流程設定（§9.16）。

### 12.1 背景

多階段之後後端已經完整，但前端只是把資料攤開：待辦沒有入口、列表預設混著歷史紀錄、詳情是擠在對話框裡的時間軸，看不出誰還沒動作；
申請人送出後只看得到「待審核」，被駁回也沒有重新送出的入口。這一版只改互動與引導，不改狀態機與權限模型。

### 12.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **詳情只有整頁，移除 `ApprovalDetailDialog`**；route id 不變 | 多關的流程與留言在對話框裡放不下；設計系統沒有 Drawer；快速決定由列表的 ✓／✗ 處理 |
| D2 | **首頁待辦是 backstage `core/home` 的區塊註冊表**，不放 web-core | feature 之間不能 import，本來就要注入點；只有一個 app 用的程式留在 app |
| D3 | **待審數靠 `approval` 推播失效 ＋ 視窗聚焦重查**，不輪詢；`NavItem.useBadge` 是選用的 hook | 推播的受眾已涵蓋所有會變動數字的人；徽章是通用能力，其他 feature 之後可用 |
| D4 | **審批登記為可留言的資源，定案後仍可留言** | 沿用 `24-comment.md` D3，不擴充通用模組；定案後的溝通（為什麼被駁回）是主要需求 |
| D5 | **決定後只在「從待審清單進來」時跳下一筆**，不做偏好 | 行為只出現在預期它的情境；偏好設定等有需求再加 |
| D6 | **流程範本是前端內建常數**，依 `requester` 與規則種類的可用性過濾 | 目的只是避開空白表單；每個類型只有一個流程（§10.2 D1），自訂範本的使用次數極低，不需要資料表與權限 |
| D7 | **核准的結果句由前端依類型產生**（`APPROVAL_OUTCOME_KEY`，`satisfies` 強制補齊） | 顯示文字本來就在前端語系；不加 handler 方法 |
| D8 | **重新送出：前端依類型導回原申請入口並預填；後端在 `ApprovalService.submit()` 統一驗證 `resubmittedFrom`** | 申請的入口在擁有者的頁面；驗證放在通用模組，各類型不必各寫一份 |
| D9 | **流程的實際運作開頁時即時查詢近 30 天**，不做快照 | 量小、只有設定者會看；以 `(status, created_at)` 的索引就查得到，慢了再改快照 |
| D10 | **流程可以重設（刪掉）**，取代原本的「不刪除，只能停用」（§10）；整份設定留在稽核 `approvalFlow.reset` | 使用者要能「回到初始」：停用會留下一份看似還在的設定，重新開始時還得逐關刪除。已送出的請求帶著關卡的快照，流程本身不需要留著；需要舊設定時稽核裡有完整的一份 |

### 12.3 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 保留對話框，另做整頁 | 兩種版面要同步維護；對話框的高度放不下流程與留言 |
| 新增 Drawer 元件做快速檢視 | 為一個頁面擴充設計系統，效益低於成本 |
| 首頁直接 import 審批的元件 | 違反 feature 之間的邊界（前端規則 2） |
| 徽章定期輪詢 | 推播已可靠；輪詢在多分頁時放大請求量 |
| 定案後留言唯讀 | 要擴充 `comment` 的通用介面；而且擋掉最需要的溝通 |
| handler 加 `describeOutcome`／`resubmit` | 後端回傳顯示文字或前端路由，違反「後端只給 key」的約定 |
| 租戶自訂流程範本（存成資料） | 每個類型只有一個流程，設定一次就很少再從頭來（D6） |
| 流程的實際運作由背景工作每小時彙總 | 多一個工作與一張表，量還不需要（D9） |
| 重設以軟刪除或版本歷史保留舊流程 | 沒有畫面會讀它；稽核已有整份設定，另存一份只是第二個事實來源（D10） |

### 12.4 實作紀錄

| 項目 | 補充 |
| --- | --- |
| 「已重新送出為」 | `resubmitted_from` 沒有索引：以「申請人 ＋ `resubmitted_from`」查（走「我的申請」的索引），只在申請人不是 null、請求已結束時查。重新送出一定是同一個申請人（D8 的驗證） |
| 「從待審清單進來」 | 網址的 `queue`（`true`）；列表、「待我審核」、首頁的待辦點進詳情時帶上，通知的連結沒有。網址的值是字串，`validateSearch` 兩者都收 |
| 「下一筆」 | 進入詳情時記下清單的順序（列表剛載入過，快取裡有），定案後重新取得同一份清單，從原本排在後面的找起；都不在了就取新清單裡第一筆不是原本排在前面的 |
| 留言的推播 | 留言的推播沿用 `approval` 來源的受眾（`approval:read`）：申請人與候選人收得到 @提及與關注的通知，但畫面上的留言要重新整理或回到頁面才更新 |
| 待審數與單關 | 「待我審核」只算多階段的關卡（單關請求由 `approval:review` 的持有者審，算在「審批」的徽章與首頁的全部待審數） |
| 流程摘要的結果句 | 流程設定（`features/approval-flow`）不 import 審批頁的 `APPROVAL_OUTCOME_KEY`，另有一句不帶參數的 `APPROVAL_FLOW_OUTCOME_KEY` |
| 關卡的展開 | 預設不記狀態：沒有 `key` 的關卡（範本、新增的）展開、有 `key` 的收合；手動切換以畫面上的 id 記住，儲存或重新載入後回到預設 |
| 自動試算 | 保留「試算」鈕（立即重算）；結果只在對應目前的草稿時顯示，避免摘要標出過期的略過 |
| 最後一關的權限說明 | 只寫在最後一張卡片上：條件會讓實際最後執行的關卡往前移，句子寫「略過的不算」，不另外試算 |
