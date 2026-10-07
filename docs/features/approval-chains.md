# 多階段審批鏈

- 優先度：P2
- 狀態：規劃中
- 依賴：—（延伸既有的 [`backend/20-approval.md`](../architecture/backend/20-approval.md)）；審核者「主管」需要 [`organization.md`](./organization.md)（軟依賴，D14）
- 相關：[`backend/20-approval.md`](../architecture/backend/20-approval.md) §1（Phase 0 明列「不做」）、§3（狀態機）、§4（handler）；
  [`iam/07-groups.md`](../architecture/iam/07-groups.md)（以群組指定審核者；群組本身也可由平台關閉）；[`backend/15-notification.md`](../architecture/backend/15-notification.md) §9（待審通知）；
  [`05-tenancy.md`](../architecture/05-tenancy.md) §5.1、§12（平台可關閉的 feature）；[`backend/14-revisions.md`](../architecture/backend/14-revisions.md)（流程的版本歷史）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

審批目前是 **一關**：`pending` → `approved` ｜ `rejected`，持有 `approval:review`（以及 handler 要求的權限）的任何一個人都能定案
（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §3）。§1 的「不做」明列了「多階段／多人會簽、依金額或條件分流的審批鏈」。

B2B 的業務功能（採購、請款、合約、價格調整、權限申請）幾乎都需要：

- **依序多關**：主管 → 財務 → 總經理。
- **會簽**：同一關要 N 人中的 M 人同意。
- **條件分流**：金額超過門檻才多一關；依部門找不同的審核者。

這些若由每個業務模組自己做，狀態機、四眼原則、通知、稽核都會各寫一份。

另外兩個前提：

- **「申請人的主管」需要組織架構**，系統現在沒有——由 [`organization.md`](./organization.md) 補上。
- **多階段審批鏈要能被平台關閉**（`approvalChain`），而且它依賴的組織管理（`organization`）、群組（`group`）也都可以各自被關閉。
  設計必須回答「任一個被關掉時，送出中、進行中的請求怎麼辦」（D12～D14）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶管理者在畫面上為每一種審批類型設定 **流程**：依序的多個關卡（D1） | 圖形化流程設計器、平行分支後再合流 |
| 每一關的審核者：指定的使用者、群組、角色、申請人的第 N 層主管、某部門的主管（D3） | 任意腳本或運算式語言的條件 |
| 會簽：一關需要 M 人同意或「全部」；任一人駁回即整筆駁回（D5） | 加簽、轉簽、代理人（請假代簽）——卡住時由 `approval:override` 處理（D10） |
| 條件：每一關可以有「欄位 運算子 值」的條件（AND），欄位由 handler 宣告，送出時判斷（D2） | 逾期自動升級、催簽 |
| 試算：給定申請人與欄位值，預覽會走哪些關卡、每關是誰 | 關卡層級的對外 webhook（只有最終的 `approval.decided`） |
| 「我的審批」：待我審核、我的申請（含撤回）（D8） | 對外 API 的審批端點 |
| 詳情頁顯示每一關的進度與每個人的意見 | 依金額自動選「流程」（一個類型只有一個流程，分流靠關卡的條件） |
| 既有單關類型的行為不變；沒有設定流程的類型照舊一關 | |
| **平台可關閉**（`approvalChain`）；組織、群組被關閉時優雅退化（D12～D14） | 平台層的 feature 相依（打開 A 必須先打開 B） |

## 使用者故事

**作為採購承辦，我希望 5 萬元以上的申請自動多一關財務，以便不用自己判斷要找誰簽。**

- **Given** 審批類型 `purchase.request` 的流程是「部門主管」→「財務（條件：金額 ≥ 50,000）」
- **When** 我送出 80,000 元的申請
- **Then** 申請依序經過「部門主管」→「財務」兩關；主管核准後，財務群組的成員才收到待審通知；
  送出 30,000 元時「財務」關顯示為「略過（條件不符）」

**作為財務，我希望會簽要兩個人同意才通過，以便大額支出不是一個人說了算。**

- **Given** 「財務」關設定為 2 人同意
- **When** 第一位財務核准
- **Then** 申請仍停在這一關、顯示「1／2」；第二位核准後才進入 `handler.apply`

**作為部門主管，我沒有 `approval:read`，但希望看到並處理指派給我的申請。**

- **Given** 我是「北區」的主管，Carl 的主要部門是北區
- **When** Carl 送出申請
- **Then** 我收到通知，在「我的審批 → 待我審核」看得到這一筆並能核准；我看不到審批總表的其他申請

**作為租戶管理者，我希望流程卡住（審核者離職、部門被刪）時有人能處理，以便申請不會永遠懸著。**

- **Given** 「財務」關的群組被刪除，關卡啟動時找不到審核者
- **When** 申請進入這一關
- **Then** 持有 `approval:override` 的人收到「審批找不到審核者」通知，可以 **重新展開審核者**（修好群組之後）或 **強制定案** 這一關（必填意見）

**作為平台營運，我希望關掉某租戶的多階段審批，以便方案降級後審批回到單關，進行中的申請也不會卡住。**

- **Given** 租戶有 3 筆停在「財務」關的申請
- **When** 我關閉 `approvalChain`
- **Then** 新的申請一律單關；那 3 筆改由持有 `approval:review` 的人在審批頁一次定案，剩下的關卡標為「已取消（多階段審批停用）」；
  重新打開後，還沒定案的從原本的關卡繼續

## 名詞

| 名詞 | 意思 |
| --- | --- |
| 流程（flow） | 一種審批類型的關卡設定；一個類型最多一個，存在 `approval_flows`，有版本 |
| 關卡（step） | 流程裡的一關；送出時複製一份成為請求的 `approval_steps`（快照） |
| 審核者規則（assignee） | 關卡要找誰：`user`／`group`／`role`／`manager`／`orgUnit` |
| 候選人（candidate） | 關卡 **啟動** 時依規則展開、再扣掉不合格者的那一群人，落地在 `approval_step_assignees` |
| 短缺（shortage） | 候選人為 0（`noCandidate`）或少於要求的同意數（`insufficient`） |
| 單關請求 | `current_step IS NULL` 的請求：沒有流程、或送出時 `approvalChain` 未啟用。行為與今天完全相同 |

## 初步構想

### 1. Handler 的延伸

`ApprovalHandler`（`modules/approval/approval.types.ts`）加一個 **選用** 的宣告；沒有宣告的類型永遠是單關（D18）：

```ts
interface ApprovalHandler {
  // …既有的方法不變
  /** 這個類型支援多階段流程時提供。 */
  readonly flow?: ApprovalFlowSupport;
}

interface ApprovalFlowSupport {
  /** 申請人是登入者還是匿名（註冊）。匿名的類型不能用 `manager` 規則（沒有申請人可以往上找）。 */
  requester: 'user' | 'anonymous';
  /** 條件可以用的欄位；值由 handler 從 payload 取出（payload 的形狀只有 handler 知道）。 */
  fields: ApprovalConditionField[];
}

interface ApprovalConditionField {
  key: string;                       // 'amount'
  labelKey: string;                  // 前端語系鍵
  type: 'number' | 'string' | 'enum';
  options?: readonly string[];       // enum 的值
  read(payload: Record<string, unknown>): number | string | null;
}
```

第一批支援流程的類型：`user.register`（欄位：`emailDomain`）。`fileFolder.access` **不支援**：它的審核資格是資源層級的（資料夾的 `share`），
另一條審核入口在檔案管理器（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §7）。之後的業務類型（採購、請款）在實作時宣告 `flow`。
整合測試另外註冊一個只在測試裡存在的類型（`test.purchase`，欄位 `amount`、`category`）驗證完整的分流。

### 2. 審核者規則的解析（可登記，D15）

`modules/approval` 是通用模組，不能 import `modules/organization`。比照 handler 的登記方式，規則的種類由擁有者登記：

```ts
interface ApprovalAssigneeResolver {
  readonly kind: 'user' | 'group' | 'role' | 'manager' | 'orgUnit';
  /** 這個種類目前能不能用（例：organization 未啟用 → false）；流程編輯與試算用。 */
  isAvailable(): boolean;
  /** 展開成使用者 id；找不到、已刪除、feature 未啟用一律回空陣列，不拋錯。 */
  resolve(rule: AssigneeRule, ctx: { requesterId: string | null }, tx: DbOrTx): Promise<string[]>;
  /** 規則的顯示名稱快照（群組名、部門名、使用者名稱）。 */
  describe(rule: AssigneeRule, tx: DbOrTx): Promise<string>;
}
```

| kind | 登記者 | 展開 |
| --- | --- | --- |
| `user` | approval（內建） | 該使用者 |
| `group` | approval（內建，經 `core/authz`） | 群組（含巢狀）的成員；`group` feature 停用時 `core/authz` 的成員關係本來就暫停 → 空 |
| `role` | approval（內建，經 `PermissionService`） | 角色的持有者（直接 ＋ 經由群組；群組停用時只有直接持有） |
| `manager` | organization | `OrgChartService.managersOf(requester, level)`；`level` 1–5 |
| `orgUnit` | organization | `OrgChartService.managersOfUnit(unitId)` |

`organization` 模組沒有載入或 feature 未啟用時，`manager`／`orgUnit` 的 `isAvailable()` 為 false、`resolve()` 回空陣列（[`organization.md`](./organization.md) D2）。

### 3. 資料模型（租戶 DB）

```
approval_flows                                  每種類型的流程設定
  id uuid pk
  type text                                     unique WHERE deleted_at IS NULL（實際上不刪，見下）
  enabled boolean                               false = 這個類型回到單關（設定保留）
  allow_repeat_approver boolean default false   同一個人能不能在同一筆請求審兩關（D6）
  steps jsonb                                   [{ key, name, assignee, requiredApprovals, conditions }]（zod 驗證）
  version integer                               樂觀鎖
  created_at / created_by / updated_at / updated_by

approval_requests                               既有，新增：
  flow_id uuid null → approval_flows.id         null = 單關請求
  flow_version integer null                     送出時的流程版本（詳情顯示「依第 3 版流程」）
  current_step smallint null                    目前關卡的 ordinal；單關請求永遠 null
  resubmitted_from uuid null → approval_requests.id   駁回或撤回後重新送出（D7）
  status 列舉加 'withdrawn'

approval_steps                                  送出時從流程複製（快照）
  id uuid pk
  request_id uuid → approval_requests.id
  ordinal smallint                              0 起算；unique (request_id, ordinal)
  key text                                      流程裡的關卡 key（跨版本追蹤同一關）
  name text
  assignee jsonb                                規則 ＋ 顯示名稱快照 { kind, id?, level?, label }
  required_mode text                            'count' | 'all'
  required_approvals smallint null              count 模式在送出時填；all 模式在啟動時填入候選人數
  conditions jsonb                              條件快照（只用來顯示「為什麼略過」）
  status approval_step_status                   waiting | active | approved | rejected | skipped | cancelled
  shortage text null                            null | 'noCandidate' | 'insufficient'
  close_reason text null                        cancelled 的原因：'rejected' | 'withdrawn' | 'chainDisabled' | 'override'
  activated_at / closed_at timestamptz null
  unique (request_id) WHERE status = 'active'   同一筆請求同時只有一個進行中的關卡

approval_step_assignees                         關卡啟動時展開的候選人
  step_id uuid → approval_steps.id
  request_id uuid                               冗餘，給「待我審核」用
  user_id uuid → users.id
  added_by text                                 'activation' | 'refresh'
  added_at timestamptz
  pk (step_id, user_id)
  index (user_id, request_id)

approval_decisions                              每一個人的每一次決定
  id uuid pk
  request_id uuid / step_id uuid
  reviewer_id uuid null / reviewer_name text    名稱快照
  decision text                                 'approve' | 'reject'
  via text                                      'assignee' | 'override' | 'legacy'（D12：停用期間以單關端點定案）
  comment text null
  decided_at timestamptz
  unique (step_id, reviewer_id)
```

- `approval_requests` 的 `reviewer_*`、`review_comment`、`reviewed_at` 仍記 **最後定案的那個人**，列表與既有的前端、webhook、結果信不必改。
  撤回時 `reviewed_at` = 撤回時間、`reviewer_*` 為 null（`approval_requests_reviewed_consistency` 不必改）。
- 流程 **不刪除**，只能停用（`enabled = false`）：刪除後進行中的請求仍要能看到「依哪一版流程」。版本歷史以 `RevisionService.record`（類型 `approvalFlow`）記錄，
  可以還原到某一版（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md)）。
- 流程的限制：最多 10 關、每關最多 5 個條件、`requiredApprovals` 1–20。

### 4. 狀態機

**請求**

```
                         submit
  (無) ───────────────────────────────▶ pending ──最後一關達到同意數（handler.apply）──▶ approved
                                          │ ├────任一關有人駁回、或 override 駁回 ─────▶ rejected
                                          │ └────申請人撤回 ──────────────────────────▶ withdrawn
                                          └ current_step 隨關卡推進
```

**關卡**

```
 送出時：條件不符 ─▶ skipped
         其他    ─▶ waiting ──輪到它（activate）──▶ active ──同意數達到／override 核准──▶ approved
                                                     ├──任一人駁回／override 駁回 ────▶ rejected
                    waiting／active ──請求被駁回、撤回、停用期間單關定案──▶ cancelled
```

### 5. 送出

`ApprovalService.submit()` 判斷要不要走流程：

```
handler.flow 有宣告  且  approvalChain 已啟用  且  該類型有 enabled 的流程
  → 走流程；否則 → 單關（今天的行為，連 approval.pending 的收件人都相同）
```

走流程時，在送出的同一個交易：

1. 寫入請求（`flow_id`、`flow_version`）。
2. 依序複製關卡；以 `handler.flow.fields[].read(payload)` 取值判斷條件，不符合的關卡 `skipped`（條件一律在送出時判斷：payload 送出後不會變，D2）。
3. **全部關卡都被略過** → 請求照樣建立，`current_step = null`、退回單關的審核方式（`approval:review`）。不自動核准：條件寫錯不該變成沒人審。
4. 啟動第一個 `waiting` 的關卡（§6）。
5. 稽核 `approval.submit`（`metadata`：`flowId`、`flowVersion`、略過的關卡）。

### 6. 關卡的啟動

```
activate(step)：
  C ← resolver(step.assignee.kind).resolve(rule, requester)
  C ← C − {申請人}                                 四眼原則
  C ← C − {停用、刪除、服務帳號}
  allow_repeat_approver = false → C ← C − {這筆請求前面關卡做過決定的人}       D6
  step 是最後一個會執行的關卡 → C ← {u ∈ C | u 持有 handler.requiredPermissions(base)}   D3
  寫入 approval_step_assignees（added_by = 'activation'）
  required ← required_mode = 'all' ? |C| : required_approvals
  |C| = 0 → shortage = 'noCandidate'；|C| < required → shortage = 'insufficient'
  通知：C 的每個人 approval.pending（帶關卡名）；有 shortage → approval:override 的持有者 approval.unassigned
```

- 候選人在 **啟動當下** 展開並落地（D4）。之後群組成員異動、主管更換 **不會** 自動改變名單；要套用新名單由 `approval:override` 的人按「重新展開審核者」。
- 有短缺時關卡照樣 `active`：`insufficient` 的候選人仍可以先同意，剩下的由 override 補上；**不自動降低同意數、不自動跳過、不自動核准**（D9）。
- 解析在送出或上一關定案的交易內執行：讀到的是那個時間點的群組、角色、部門。

### 7. 做出決定（D16）

```
POST /approvals/:id/steps/:ordinal/decisions   { decision: 'approve' | 'reject', comment?, roleIds? }

① 交易外：請求存在、approvalChain 已啟用
② BEGIN
   SELECT … FROM approval_requests WHERE id = ? FOR UPDATE            同一筆請求的決定排隊
   ├ status ≠ pending                → 409 APPROVAL_ALREADY_REVIEWED
   ├ current_step ≠ :ordinal         → 409 APPROVAL_STEP_STALE（畫面過期，重新取得）
   ├ 申請人本人                       → 403 APPROVAL_SELF_REVIEW
   ├ 不在候選人裡、或帳號不是 active → 403 APPROVAL_NOT_ASSIGNED
   ├ INSERT approval_decisions       → unique 衝突 409 APPROVAL_STEP_ALREADY_DECIDED
   ├ reject：關卡 rejected、其餘 waiting 改 cancelled（close_reason 'rejected'）、請求 rejected
   │         ＋ 既有駁回的收尾（approval.reject 稽核、結果信、approval.result、webhook approval.decided）
   └ approve：同意數 ＋1
        未達 required → approval.stepApprove 稽核
        達到、還有下一關 → 關卡 approved → activate(下一個 waiting) → current_step 前進
                          → approval.stepApprove 稽核、申請人 approval.progress
        達到、這是最後一關 → handler.requiredPermissions(ctx) ＋ assertApprovable(ctx)（在鎖之內）
                          → 既有 §3.4 的核准：status approved、handler.apply(tx)、result_resource_id、
                            approval.approve 稽核、結果信、approval.result、webhook approval.decided
   COMMIT
③ 最後一關：handler.afterApply()
④ 發佈 approval update
```

- 「會不會是最後一關」要在鎖之內才知道（別人可能剛好先同意），所以權限與 `assertApprovable()` 在鎖之內檢查——
  它們都是唯讀查詢，多佔一點鎖的時間換正確性。
- `roleIds` 只在最後一關、類型是 `user.register` 時有意義（與今天的 `POST /approvals/:id/approve` 相同）。

### 8. 卡住時的處理：`approval:override`（D10）

| 動作 | 端點 | 做什麼 |
| --- | --- | --- |
| 重新展開審核者 | `POST /approvals/:id/steps/:ordinal/refresh` | 依快照的規則重新解析，**只增不減**（已同意的人保留）；新加入的人收到 `approval.pending`；重新計算短缺。稽核 `approval.stepRefresh` |
| 強制定案這一關 | `POST /approvals/:id/steps/:ordinal/override` `{ decision, comment }` | 意見必填。核准 → 這一關直接 approved（不管同意數），往下一關；駁回 → 整筆駁回。決定記為 `via = 'override'`。四眼原則照舊；最後一關的核准照舊要 handler 的權限。稽核 `approval.override` |

- `approval:override` 是高風險的鍵：預設只有 `super-admin`、`admin`。
- 只能強制定案 **目前** 這一關；不能一次跳過好幾關（要跳就逐關處理，每一關都留下紀錄）。

### 9. 申請人：我的申請與撤回（D7、D8）

- 申請人看得到自己送出的請求（不需要 `approval:read`），包括每一關的進度與意見。
- `POST /approvals/:id/withdraw`：只有申請人、只限 `pending`。關卡全部 `cancelled`（`close_reason 'withdrawn'`）、請求 `withdrawn`；
  目前關卡的候選人收到推播（從待審清單消失），不另外通知。稽核 `approval.withdraw`。單關請求也能撤回。
- 駁回或撤回後 **重新送出是一筆新的請求**：送出端可以帶 `resubmittedFrom`，詳情顯示「前一次的申請」連結與當時的意見，前面的關卡不沿用。

### 10. 可見性（誰看得到一筆請求）

| 誰 | 看得到 |
| --- | --- |
| `approval:read` | 全部（今天的行為） |
| 申請人 | 自己送出的 |
| 候選人 | 自己曾經是候選人的請求（任一關，含已結束的） |
| `approval:override` | 全部（處理卡住的請求需要；`approval:override` 依賴 `approval:read`） |

候選人與申請人的存取是 **請求層級** 的（與 `fileFolder.access` 由資料夾管理者審核同一個想法：被指派本身就是授權），不必給他們 `approval:read`。

### 11. 平台可關閉：`approvalChain`（D12、D13）

`TENANT_FEATURES` 加 `approvalChain`；**審批本身（單關）仍是常駐的**，只有「多階段」可以關閉。

| | `approvalChain` 停用時 | 照舊 |
| --- | --- | --- |
| 流程設定 | `/approval-flows` 回 `404 FEATURE_DISABLED`；backstage 沒有「審批流程」頁 | 流程與版本歷史保留 |
| 新的申請 | 一律單關（不看流程） | — |
| 進行中的多關請求 | 關卡的決定、override、refresh 端點回 404；**改由 `POST /approvals/:id/approve`／`reject`（`approval:review` ＋ 類型要求的權限）一次定案**，目前與之後的關卡 `cancelled`（`close_reason 'chainDisabled'`），決定記為 `via = 'legacy'` | 已做出的決定與意見 |
| 「我的審批」 | 「待我審核」分頁不顯示；`?scope=assigned` 回空 | 「我的申請」與撤回 |
| 詳情 | 關卡時間軸 **唯讀** 顯示（那是誰同意過的紀錄），沒有關卡的操作鈕 | — |
| 通知 | 不再有 `approval.unassigned`、`approval.progress` | `approval.result` |
| 重新啟用 | 停用期間沒有定案的請求 **從原本的關卡繼續**；候選人沿用當時的名單（要更新就 refresh） | — |

`TenantFeatureImpacts` 登記 `approvalFlows`（啟用中的流程數）與 `approvalRequestsInChain`（進行中的多關請求數），
apps/platform 關閉前的確認框列出來，並說明「進行中的申請改由審批管理者一次定案」。

### 12. 組織、群組被關閉時（D14）

| 被關閉的 feature | 對審批鏈的影響 |
| --- | --- |
| `organization` | `manager`／`orgUnit` 規則展開為空 → 關卡 `noCandidate` → override 處理。流程編輯：既有流程照樣顯示（規則旁標示「組織管理未啟用」），**新增或修改** 用到這兩種規則的關卡回 `422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE`；只改其他欄位的儲存不擋（否則管理者連停用流程都做不到）。試算顯示這些關卡會找不到人 |
| `group` | `group` 規則展開為空；`role` 規則只剩直接持有的人（群組帶來的持有暫停，與權限判斷一致）。流程編輯同上 |
| 規則指到的群組、角色、部門、使用者被刪除 | 同「展開為空」；流程編輯標示「已刪除」 |

`organization` 的 `TenantFeatureImpacts` 另由 approval 模組登記 `approvalFlowsUsingOrg`（用到 `manager`／`orgUnit` 規則、啟用中的流程數），關閉組織管理的確認框一併列出。

不做平台層的「feature 相依」（例：打開 `approvalChain` 必須先打開 `organization`）：沒有組織時，審批鏈仍可以用使用者、群組、角色；
相依只會讓平台管理者多一道操作順序的限制。apps/platform 只在 `approvalChain` 開、`organization` 關時於說明文字提示「主管類的審核者無法使用」。

### 13. API

| Method | Path | 授權 | 說明 |
| --- | --- | --- | --- |
| GET | `/approvals` | `@Authenticated()`，service 依 scope 檢查 | `scope=all`（預設，需 `approval:read`，今天的行為）／`assigned`（待我審核：我是目前關卡的候選人、還沒決定）／`mine`（我送出的）。列多帶 `currentStep: { ordinal, name, approvals, required, shortage } \| null` |
| GET | `/approvals/:id` | `@Authenticated()`，§10 的可見性；看不到回 `404 APPROVAL_NOT_FOUND` | 多帶 `steps[]`（關卡、候選人、決定、意見）與 `viewer: { canDecide, canOverride, canWithdraw, blockedReason }` |
| POST | `/approvals/:id/approve`／`reject` | `approval:review`（不變） | 單關請求：不變。多關請求：`approvalChain` 啟用時回 `409 APPROVAL_CHAIN_IN_PROGRESS`（請改用關卡端點）；停用時一次定案（§11） |
| POST | `/approvals/:id/steps/:ordinal/decisions` | `@Authenticated()` ＋ `@RequireFeature('approvalChain')`；service 檢查候選人 | §7 |
| POST | `/approvals/:id/steps/:ordinal/refresh` | `approval:override` ＋ `@RequireFeature('approvalChain')` | §8 |
| POST | `/approvals/:id/steps/:ordinal/override` | `approval:override` ＋ `@RequireFeature('approvalChain')` | §8 |
| POST | `/approvals/:id/withdraw` | `@Authenticated()`，申請人本人 | §9；非申請人 `403 APPROVAL_NOT_REQUESTER`、已結束 `409 APPROVAL_ALREADY_REVIEWED` |
| GET | `/approval-flows` | `approvalFlow:read` ＋ `approvalChain` | 支援流程的類型（`handler.flow` 有宣告的），每一列帶該類型的欄位定義、流程（若有）、是否啟用、版本 |
| GET | `/approval-flows/:type` | `approvalFlow:read` ＋ `approvalChain` | 流程；規則帶顯示名稱與狀態（`available`、`deleted`） |
| PUT | `/approval-flows/:type` | `approvalFlow:update` ＋ `approvalChain` | 建立或取代；更新必帶 `version`（`409 APPROVAL_FLOW_VERSION_CONFLICT`）。類型不支援 `422 APPROVAL_FLOW_NOT_SUPPORTED`；內容不合法 `VALIDATION_FAILED`（`fields["steps.1.conditions.0.field"]`）；匿名類型用 `manager` 也算不合法 |
| POST | `/approval-flows/:type/preview` | `approvalFlow:read` ＋ `approvalChain` | 試算：`{ steps?（未儲存的草稿）, requesterId?, fields: { amount: 80000 } }` → 每一關會不會略過、候選人、短缺。**唯讀**，與 §6 共用同一段解析 |

- `scope=all` 的 `@RequirePermissions` 改成 service 檢查之後，路由宣告從 `approval:read` 改為 `@Authenticated()`；`test/route-audit.spec.ts` 的對照跟著改。
  前端的頁面權限不變（總表仍是 `APPROVAL`／`approval:read`）。
- 流程的版本歷史與還原沿用 `/revisions` 的通用端點（類型 `approvalFlow`），還原要 `approvalFlow:update` 並受 D11 限制。

錯誤碼（`packages/error-codes`）：`APPROVAL_STEP_STALE`、`APPROVAL_NOT_ASSIGNED`、`APPROVAL_STEP_ALREADY_DECIDED`、`APPROVAL_CHAIN_IN_PROGRESS`、`APPROVAL_NOT_REQUESTER`、
`APPROVAL_FLOW_NOT_SUPPORTED`、`APPROVAL_FLOW_VERSION_CONFLICT`、`APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE`。

### 14. 權限

| 權限鍵 | 顯示名稱 | 說明 | 依賴 | 預設角色 |
| --- | --- | --- | --- | --- |
| `approval:override` | 強制定案審批 | 重新展開審核者、強制定案目前的關卡；最後一關的核准另需類型要求的權限 | `approval:read` | super-admin、admin |
| `approvalFlow:read` | 檢視審批流程 | 流程設定、試算 | — | super-admin、admin、auditor |
| `approvalFlow:update` | 設定審批流程 | 建立、修改、停用流程，還原到某一版。**受反提權限制**（D11） | `approvalFlow:read` | super-admin、admin |

- `approvalFlow:update` 列進 [`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §9.2 G4 的「受反提權限制的鍵」（不能被任何鍵包含）。
- 關卡的審核 **不需要** `approval:review`：被流程指派就是授權（D3）。`approval:review` 只用於單關請求與 §11 的停用期間。

### 15. 通知、推播、稽核、webhook

**站內通知**（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §9；都在業務交易內）

| 類型 | 收件人 | 時機 | 預設 |
| --- | --- | --- | --- |
| `approval.pending`（既有，`params` 多一個選填的 `stepName`） | 單關：持有 `approval:review` 的人（不變）；多關：該關候選人 | 送出、關卡啟動、refresh 新加入的人 | 開 |
| `approval.progress`（新） | 申請人 | 一關通過、往下一關 | 開（使用者可在事件管理關掉，[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md)） |
| `approval.unassigned`（新） | 持有 `approval:override` 的人 | 關卡啟動時短缺 | 開 |
| `approval.result`（既有） | 申請人 | 最終核准、駁回 | 不變 |

多關的通知連結一律指向「我的審批」的詳情（`approvalTask.detail`），候選人沒有 `approval:read` 也打得開。

**推播**：`ChangeSource.APPROVAL` 的受眾從「`approval:read` 的人」擴大為「`approval:read` ＋ 申請人 ＋ 目前關卡的候選人」的 user room。

**稽核**

| action | 內容 |
| --- | --- |
| `approval.submit`（既有） | 多 `flowId`、`flowVersion`、略過的關卡 |
| `approval.stepApprove`／`approval.stepReject` | `metadata`：`stepOrdinal`、`stepName`、`approvals`／`required`；意見 |
| `approval.stepRefresh` | 新加入的候選人 |
| `approval.override` | 關卡、決定、意見 |
| `approval.withdraw` | — |
| `approval.approve`／`approval.reject`（既有） | 最終結果；停用期間的單關定案多 `metadata.chainDisabled = true` |
| `approvalFlow.update` | `before`／`after` 是整份流程；啟用、停用也是這個 action |

**Webhook**：不變，只有最終的 `approval.decided`。

**指標**：`approval_step_shortages_total{reason}`（`noCandidate`／`insufficient`）——流程設定不完整的訊號（[`08-monitoring.md`](../architecture/08-monitoring.md) §2.4；不帶租戶標籤）。

### 16. 前端（backstage）

**`features/approval`（常駐，擴充）**

- 總表：多一欄「進度」（`2／3 財務 1／2`，有短缺時標示）。
- 詳情對話框：關卡時間軸 `ApprovalTimeline`（每一關的規則、候選人、每個人的決定與意見、略過的原因、短缺）；
  footer 依 `viewer` 顯示「同意／駁回」（我是候選人）、「強制定案／重新展開」（`approval:override`）、或單關的核准／駁回。
- 新頁 **「我的審批」** `/my-approvals`（個人頁，不需要權限；[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §2.18）：
  「待我審核」（`approvalChain` 已安裝時才有）、「我的申請」（撤回、重新送出的連結）。詳情 `/my-approvals/$approvalId`（route id `approvalTask.detail`）。
  側欄入口帶待我審核的數量。
- 快速審核與批次審核：只對單關請求；多關請求在列表上只有「開啟」。

**`features/approval-flow`（可啟用，`FEATURE_CATALOG` 的 `approvalChain`）**

- `/approval-flow`：支援流程的類型清單，每一列顯示流程狀態（未設定／啟用／停用）與關卡摘要。頁面權限 `APPROVAL_FLOW`（`approvalFlow:read`）。
- `/approval-flow/$type`：流程編輯。關卡清單可拖曳排序；每一關：名稱、審核者規則（種類 → 使用者搜尋／群組／角色／主管層級／`OrgUnitPicker`）、
  同意數（數字或「全部」）、條件列（欄位 → 運算子 → 值，依欄位型別換輸入元件）。右側「試算」面板即時呼叫 preview。
  無法使用的規則（組織、群組未啟用、目標已刪除）以警示標出。版本衝突用 `VersionConflictAlert`；「歷史」開版本歷史。
- 規則選擇器裡的「主管」「部門」選項在 `organization` 未安裝時停用並說明原因；「群組」同理看 `group`。

### 17. 平台（apps/platform）

- `TENANT_FEATURE_LABEL_KEY`／`DESCRIPTION_KEY` 加 `approvalChain`（「多階段審批」）。
- 關閉前的確認框：影響數量（§11）與說明。`approvalChain` 開、`organization` 關時，在 feature 列表的說明文字提示（§12）。

### 18. 實作切分

| 步驟 | 內容 | 可以並行 |
| --- | --- | --- |
| O1 | 組織：後端、權限、可關閉、`OrgChartService`（[`organization.md`](./organization.md)） | 與 C1 |
| C1 | 審批鏈核心：資料表、handler 的 `flow`、resolver 登記（先只有 user／group／role）、送出、啟動、決定、單關相容、撤回、可見性；以 `test.purchase` 整合測試 | 與 O1 |
| C2 | 流程設定 API、試算、反提權、版本歷史；override／refresh；通知與推播 | |
| O2 | organization 登記 `manager`／`orgUnit` 規則；組織的前端 | 與 C3 |
| C3 | 前端：時間軸、我的審批、流程編輯 | 與 O2 |
| C4 | 平台開關的停用語意（§11、§12）、impacts、apps/platform、E2E | |

每一步各自合進 `main`；C1 合併時沒有任何租戶啟用 `approvalChain`（D17），既有行為不變。

### 19. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元（`approval-flow.spec.ts`） | 條件判斷（每個運算子、欄位取不到值 → 條件不成立）、流程驗證（上限、匿名類型不能用 `manager`、不認得的欄位） |
| 單元（`org-chart.service.spec.ts`） | 第 N 層主管的每個邊界：主管本人送出、部門有兩位主管、沒有主要部門、走到頂、停用的主管被略過 |
| 整合（`test/approval-chain.spec.ts`，真 DB） | `test.purchase` 的完整流程；會簽 2／N；任一駁回；並行的兩個同意只推進一次（鎖）；最後一關的權限在鎖內檢查；候選人快照（啟動後改群組成員不影響，refresh 只增不減）；短缺與 override；四眼與 D6；撤回；可見性（候選人看得到、旁人 404） |
| 整合（停用語意） | 關掉 `approvalChain`：新申請單關、進行中的以單關端點定案並 cancel 剩餘關卡、關卡端點 404；重新打開後從原關卡繼續。關掉 `organization`／`group`：規則展開為空 → 短缺；流程編輯擋新增的不可用規則、不擋其他修改 |
| 前端 | 時間軸的各種狀態；我的審批的三個權限案例（候選人、申請人、旁人）；流程編輯的拖曳、條件列、試算；feature 未安裝時的隱藏 |
| E2E | 主管 → 財務（會簽 2）→ 定案的完整流程（三個帳號）；停用 `approvalChain` 後在總表一次定案 |

## 開放問題

1. 關卡定義放在 handler（程式），還是讓租戶管理者在畫面上設定？
   **結論**：畫面上設定（D1），但 **能設定什麼由 handler 決定**：handler 宣告支不支援、有哪些條件欄位；條件只有「欄位 運算子 值」的 AND，沒有運算式。
2. 「申請人的主管」需要組織架構（上下級），系統現在沒有。要不要另開「組織架構」提案，還是第一版只支援群組／角色／指定人？
   **結論**：另開 [`organization.md`](./organization.md)，與審批鏈一起做；兩者以 resolver 登記解耦（D15），任一個關掉另一個照樣能用（D14）。
3. 同一個人同時在兩關的審核者裡，能不能連審兩關？
   **結論**：預設不能，由流程的 `allow_repeat_approver` 打開（D6）。小公司「主管兼財務」的情況由管理者自己決定。
4. 申請送出後若關卡的審核者名單變了（群組成員異動），以送出當下為準還是即時展開？
   **結論**：都不是——規則在 **送出時** 快照，人在 **關卡啟動時** 展開並落地；之後要更新名單由 override 的人手動 refresh（D4）。
5. 中途駁回後，申請人能不能修改後重送同一筆（保留前面的意見），還是一律新開一筆？
   **結論**：一律新開一筆，以 `resubmitted_from` 連到前一筆（D7）。
6. 審批鏈要能被平台關閉時，進行中的請求怎麼辦？
   **結論**：降級為單關，由 `approval:review` 一次定案；重新打開後未定案的從原關卡繼續（D12、D13）。

## 設計決策

### 背景

延伸 [`backend/20-approval.md`](../architecture/backend/20-approval.md)（一關的狀態機與 handler 註冊）。三個限制：審批本身常駐、多階段可以被平台關閉、
它依賴的組織與群組也各自可以被關閉。

### 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **流程由租戶在畫面上設定，存在 `approval_flows`（每類型最多一個）；handler 以 `flow` 宣告支援與條件欄位** | 「誰簽」是租戶的組織決定，每改一次都要部署不可行；「能依什麼分流」是資料的語意，只有 handler 知道。兩者分開 |
| D2 | **條件只在送出時判斷**，形式是欄位、運算子（`eq`／`ne`／`gt`／`gte`／`lt`／`lte`／`in`）、值的 AND；取不到值時條件不成立（關卡略過）；全部略過時退回單關 | payload 送出後不變，送出時就能確定路徑，詳情能完整顯示「會經過哪幾關」；全部略過退回單關，條件寫錯不會變成沒人審 |
| D3 | **被流程指派即可審，不需要 `approval:review`**；最後一關的候選人只留下持有 handler `requiredPermissions` 的人，定案時再檢查一次 | 部門主管不該為了審自己部門的申請而看到全公司的審批；「核准等同代為執行」（[`backend/20-approval.md`](../architecture/backend/20-approval.md) §3.2）由最後一關守住 |
| D4 | **規則在送出時快照、人在關卡啟動時展開並落地**，定案時只檢查「仍在名單 ＋ 帳號 active」；名單更新靠手動 refresh（只增不減） | 通知的收件人與可審的人是同一群（與 [`backend/15-notification.md`](../architecture/backend/15-notification.md) §12.2 D5 的快照一致）；「待我審核」可以用索引查，不必每次展開群組與部門。即時展開會讓審到一半的人突然失去資格、也讓已收到通知的人點進來卻不能審 |
| D5 | **會簽：`count`（M 人）或 `all`（啟動時的候選人全部）；任一人駁回即整筆駁回** | 最常見的兩種；「多數決」「M 人駁回才駁回」沒有需求 |
| D6 | **同一個人在一筆請求只能做一次決定**，除非流程設 `allow_repeat_approver`；做法是啟動時把前面關卡做過決定的人排除在候選人外 | 多關的意義是多雙眼睛；排除在候選人外（而不是定案時才擋）讓短缺在啟動當下就看得到 |
| D7 | **駁回、撤回後重送是新的請求**（`resubmitted_from`）；申請人可以撤回自己 `pending` 的請求 | 狀態機維持單向；前一次的意見透過連結可讀。多關讓請求活得更久，沒有撤回，申請人寫錯了只能等人駁回 |
| D8 | **可見性是請求層級的**：申請人、候選人看得到自己相關的請求；新增個人頁「我的審批」 | 同 D3；與 `fileFolder.access` 由資料夾管理者審核的先例一致 |
| D9 | **短缺時不自動處理**：不跳過、不降低同意數、不自動核准；通知 `approval:override` 的持有者 | 任何自動處理都等於在租戶不知情下放寬控制；卡住比放寬安全，而且有明確的處理者 |
| D10 | **`approval:override`：重新展開審核者、強制定案目前的關卡**（意見必填、逐關、四眼、最後一關仍要 handler 的權限） | 審核者離職、部門被刪、feature 被關都會讓關卡卡住，需要一個有紀錄的出口；加簽、轉簽、代理人等完整功能留到之後 |
| D11 | **`approvalFlow:update` 受反提權限制**：設定（含還原）某類型的流程，操作者必須持有該類型 handler 的 `requiredPermissions`（不含依選項而定的部分，例如 `roleIds`） | 能設定流程的人能決定「誰可以代為執行某操作」；沒有這條，`approvalFlow:update` 就能把 `user.register` 的最後一關指給自己以外的任何人（雖然 D3 仍會過濾，但業務類型的 `requiredPermissions` 可能是空的，靠的就是這條） |
| D12 | **`approvalChain` 可由平台關閉；審批本身常駐**。停用時新申請一律單關，進行中的多關請求以既有的單關端點（`approval:review`）一次定案，剩餘關卡 `cancelled`（`chainDisabled`） | 與其他 feature 一致：關掉時資料保留、重新打開後一致；但「凍結」進行中的請求會讓租戶在降級後永遠處理不了它們，所以給一條明確的出口，並在確認框告訴平台管理者有幾筆會受影響 |
| D13 | **重新啟用後，未定案的請求從原本的關卡繼續**；候選人沿用啟動時的名單 | 停用期間沒有改動任何關卡資料，恢復是零成本；名單可能過期，refresh 可以補 |
| D14 | **不做平台層的 feature 相依**；`organization`／`group` 停用時，依賴它們的規則展開為空 → 短缺 → override。流程編輯只擋 **新增或修改** 不可用的規則 | 組織架構本來就可能不完整（沒有主要部門、部門沒有主管），「找不到人」必須有處理方式；把 feature 停用歸到同一種情況，就不必為每個組合各寫一套。只擋新增，管理者仍能停用或修改流程的其他部分 |
| D15 | **審核者規則的種類由擁有者模組登記**（`ApprovalAssigneeResolver`），`modules/approval` 不 import `modules/organization` | 通用模組不 import 業務模組（[`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §3.2），與 handler 的登記同一個形狀；組織模組沒載入時規則自然不可用 |
| D16 | **同一筆請求的決定以 `SELECT … FOR UPDATE` 鎖住請求列排隊**；「是不是最後一關」與最後一關的權限檢查都在鎖之內 | 會簽時兩個人同時按同意，只能有一個人推進關卡、只能執行一次 `handler.apply`；既有的單關以條件式 UPDATE 防併發，多關的判斷需要先讀再寫，改用列鎖 |
| D17 | **新 feature 預設不啟用**（平台 DB 的預設值不加、既有租戶不補） | 全新的加值能力，與 [`organization.md`](./organization.md) D3 相同；C1 合併時所有租戶的行為不變 |
| D18 | **handler 沒有宣告 `flow` 的類型永遠單關**；第一批只有 `user.register` 宣告，`fileFolder.access` 不宣告 | 資源層級審核的類型（資料夾）若再疊上流程，會出現兩條互相矛盾的審核入口 |

### 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 關卡完全由 handler 的程式決定（`steps(payload)`） | 簡單、好測，但租戶每換一個簽核主管就要改程式；做為「能依什麼分流」的宣告保留下來（D1） |
| 條件用運算式語言（JSONLogic、CEL） | 能力過剩、難以在畫面上編輯與驗證，也多一個要防注入的表面 |
| 候選人在定案時即時展開 | 見 D4：資格會在審到一半時改變，「待我審核」也查不了索引 |
| 短缺時自動退回 `approval:review` 的持有者 | 等於讓關卡的指派失效；以 override 處理有明確的權限與紀錄 |
| `approvalChain` 停用時凍結進行中的請求 | 降級的租戶無法處理；需要時平台得暫時打開、處理完再關 |
| 平台層的 feature 相依（`approvalChain` 需要 `organization`） | 見 D14；也讓「只用群組與角色的審批鏈」這個合理的組合無法存在 |
| 關卡另開 `approval_flow_steps` 表 | 流程是一次讀寫的整份設定，jsonb ＋ zod 驗證就夠；送出時才落地成 `approval_steps` |

## 歸檔去向

- `docs/architecture/backend/20-approval.md`：新增「多階段」章節（§1 範圍、§2 資料模型、§3 狀態機、§4 handler 的 `flow`、§8 API 的更新）與設計決策
- `docs/architecture/frontend/`：審批頁、我的審批、流程編輯的對應章節
- `docs/architecture/iam/02-permission-catalog.md`：`approval:override`、`approvalFlow` 一節、預設角色、依賴樹、G4
- `docs/architecture/05-tenancy.md` §5.1：`approvalChain` 停用時的效果
