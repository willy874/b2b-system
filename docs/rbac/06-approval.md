# RBAC 06 — 審批（Approval）

特定的變更不直接生效，而是先建立一筆 **審批請求**，由管理員核准後才套用。
第一個使用它的流程是 **使用者註冊**（`user.register`）：未登入的人送出申請，
管理員核准後才建立帳號。

> 程式碼：後端 `apps/api/src/modules/approval/`（狀態機）＋ 各類型的 handler
> （`user.register` 在 `apps/api/src/modules/user/user-registration.approval.ts`）；
> 前端 `apps/web/src/features/approval/`、註冊頁 `apps/web/src/features/auth/pages/Register/`。

---

## 1. 範圍

| 做                                                         | 不做（Phase 0）                                   |
| ---------------------------------------------------------- | ------------------------------------------------- |
| 通用的請求 → 審核 → 套用 狀態機，新類型只需實作 handler    | 多階段／多人會簽、依金額或條件分流的審批鏈        |
| `user.register`：匿名申請，核准後建立已啟用帳號            | 申請人查詢自己的申請狀態、撤回申請                |
| 審核時一併指派角色（受反提權限制）                         | 通知申請人審核結果（沒有郵件基礎設施，同啟用信）  |
| 列表、詳情、核准、駁回；即時推播給審核者                   | 請求逾期自動作廢                                  |

---

## 2. 資料模型

`approval_requests`（`apps/api/src/db/schema/approval-requests.ts`）：

| 欄位                                | 說明                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `type`                              | 請求類型，對應一個 handler（`user.register`）                                      |
| `status`                            | `pending` → `approved` \| `rejected`                                              |
| `subject_key`                       | 去重鍵（註冊 = 小寫 email）：同類型同對象同時只能有一筆待審                       |
| `payload`                           | 審核者看得到的內容（註冊 = `{ email, displayName }`）                              |
| `private_payload`                   | 只給 handler 用的內容（註冊 = 密碼雜湊）。**永不回傳、不進稽核，審核後清空**      |
| `requester_id` / `requester_name`   | 申請人；匿名申請（註冊）`requester_id = null`，名稱快照為 email                   |
| `reason`                            | 申請理由                                                                          |
| `reviewer_id` / `reviewer_name`     | 審核者（名稱快照：審核者之後被刪除仍可讀）                                        |
| `review_comment` / `reviewed_at`    | 審核意見與時間                                                                    |
| `result_resource_id`                | 核准後產生的資源（註冊 = 新使用者 id）                                            |

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
                     │
                     └──────── reject ─────────────────▶ rejected
```

- 只能從 `pending` 走一次。已審核的請求再核准／駁回 → `409 APPROVAL_ALREADY_REVIEWED`。
- 駁回後同對象可以重新申請（唯一索引只限制 `pending`）。

### 3.2 權限

| 動作 | 路由宣告          | service 另外檢查                                                           |
| ---- | ----------------- | -------------------------------------------------------------------------- |
| 讀取 | `approval:read`   | —                                                                          |
| 駁回 | `approval:review` | —                                                                          |
| 核准 | `approval:review` | handler 的 `requiredPermissions()`；缺少 → `403 AUTHZ_FORBIDDEN` ＋ `missing` |

**核准等同代為執行該操作**，所以審核者自己必須做得到——否則 `approval:review` 會變成繞過
`user:create` 的後門。`user.register` 要求 `user:create`；核准時指派角色再加 `user:assignRole`，
且角色受反提權限制（[`04-api-spec.md`](./04-api-spec.md) §5）。

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
   └ approval.approve 稽核
   COMMIT
③ handler.afterApply()             快取失效、該變更自己的領域事件（例：user create）
④ 發佈 approval update
```

與 [`../conventions/03-backend.md`](../conventions/03-backend.md) §1 規則 6 一致：稽核在交易內，
快取失效與事件在交易後。

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

3. handler 在 `onModuleInit` 呼叫 `ApprovalService.registerHandler(this)`；該模組 import `ApprovalModule`。
   `ApprovalModule` 是葉節點，不認識任何業務模組（沒有循環依賴）。
4. 提供送出請求的入口（例：`userRegistrationRequest()` 產生 `SubmitApprovalInput`），
   由呼叫端的 service 呼叫 `ApprovalService.submit()`。
5. 前端：`features/approval/constants.ts` 加類型的語系鍵；`pages/ApprovalDetail/adapter.ts`
   把該類型的 `payload` 收斂成 view model；需要額外權限時擴充 `useApprovalReviewAccess()`。
6. 更新本文件 §5 之後的類型章節、[`04-api-spec.md`](./04-api-spec.md) §7。

---

## 5. `user.register` — 註冊

### 5.1 流程

```
申請人（未登入）                     API                                   管理員
  │ POST /auth/register ─────────────▶│ 雜湊密碼（不論結果都算，耗時一致）
  │ { email, displayName,             │ email 已是使用者？→ 不建立請求
  │   password, reason? }             │ 同 email 已有待審？→ 不建立請求
  │                                   │ 否則建立 user.register（pending）
  │◀──── 202 { submitted: true } ─────│ 推播 approval create ──────────────▶│ 列表更新
  │                                   │                                     │
  │                                   │◀── POST /approvals/:id/approve ─────│ { roleIds?, comment? }
  │                                   │ 建立 status=active 的帳號（申請時的密碼）
  │                                   │ 指派角色、清空 private_payload
  │ POST /auth/login ────────────────▶│
  │◀──── 200（可以登入）──────────────│
```

### 5.2 規則

| 規則                                                             | 理由                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 回應永遠是 `202 { submitted: true }`，不透露 email 是否已存在    | 帳號列舉防護（同 `forgot-password`）                            |
| 已存在的使用者、已在審核中的 email 都不建立新請求                | 避免重複；去重不分大小寫（`users.email` 是 citext）             |
| 密碼在申請時就雜湊，只存在 `private_payload`，審核後清空         | 審核者看不到、稽核不記、資料庫不長期保留                       |
| 核准後帳號直接是 `active`，不走啟用信                            | 申請人已經設過密碼；Phase 0 沒有郵件，啟用信只會寫進伺服器日誌 |
| 申請後 email 被管理員直接建立 → 核准回 `409 USER_EMAIL_DUPLICATE`，請求保持 `pending` | 由審核者決定駁回；不自動改狀態                       |
| 核准前登入 → `401 AUTH_INVALID_CREDENTIALS`（帳號不存在）        | 不另外提示「審核中」，同樣是帳號列舉防護                       |
| 速率限制：同 IP 每分鐘 `max(3, AUTH_RATE_LIMIT / 3)` 次          | 每一筆都會進管理員的待審清單                                   |

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
| 申請帳號頁 | `/auth/register`（未登入可進；登入頁有連結）                                             |
| 審批列表   | `/approval`，Page Key `APPROVAL`（`approval:read`），選單「審批」                        |
| 審核對話框 | `/approval/$approvalId`：申請內容、角色（可搜尋多選）、審核意見；核准／駁回固定在 footer |
| 快速審核   | 列表「操作」欄：待審列的 ✓ 核准／✗ 駁回，確認後直接送出。**不指派角色、不附意見**；要指派角色改開對話框。沒有 `approval:review` 時整欄不出現；缺類型要求的權限時核准鈕停用並說明原因 |
| 權限 facade | `useApprovalPermission()`：`canReview`、`canApproveRegistration`、`canAssignRole`        |
| 可見性     | `useApprovalReviewAccess()`：未水合／無 `approval:review`／已審核 → 不顯示審核操作       |
| 快取       | `approval` 資源（`APPROVAL_LIST` ／ `APPROVAL_DETAIL`）；核准註冊另宣告 `user` create    |
| E2E        | `apps/e2e/tests/approval.spec.ts`                                                        |
