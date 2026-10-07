# 多階段審批鏈

- 優先度：P2
- 狀態：提案
- 依賴：—（延伸既有的 [`rbac/06-approval.md`](../rbac/06-approval.md)）
- 相關：[`rbac/06-approval.md`](../rbac/06-approval.md) §1（Phase 0 明列「不做」）、§3（狀態機）、§4（handler）；[`rbac/08-groups.md`](../rbac/08-groups.md)（以群組指定審核者）；
  [`backend/15-notification.md`](../architecture/backend/15-notification.md) §9（待審通知）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

審批目前是 **一關**：`pending` → `approved` ｜ `rejected`，持有 `approval:review`（以及 handler 要求的權限）的任何一個人都能定案
（[`rbac/06-approval.md`](../rbac/06-approval.md) §3）。§1 的「不做」明列了「多階段／多人會簽、依金額或條件分流的審批鏈」。

B2B 的業務功能（採購、請款、合約、價格調整、權限申請）幾乎都需要：

- **依序多關**：主管 → 財務 → 總經理。
- **會簽**：同一關要 N 人中的 M 人同意。
- **條件分流**：金額超過門檻才多一關；依部門（群組）找不同的審核者。

這些若由每個業務模組自己做，狀態機、四眼原則、通知、稽核都會各寫一份。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 審批類型可定義多個「關卡」，依序進行 | 圖形化流程設計器、平行分支後再合流 |
| 每一關的審核者：指定的使用者、群組、角色，或「申請人的主管」（若有此概念，見開放問題 2） | 任意腳本或運算式語言的條件 |
| 會簽：一關需要 M／N 人同意；任一人駁回即整筆駁回 | 加簽、轉簽、代理人（請假代簽） |
| 條件：handler 依 `payload` 回傳要走哪些關卡（程式判斷，不是設定） | 逾期自動升級 |
| 既有單關類型（`user.register`、`fileFolder.access`）行為不變 | |
| 詳情頁顯示每一關的進度與每個人的意見 | |

## 使用者故事

**作為採購承辦，我希望 5 萬元以上的申請自動多一關財務，以便不用自己判斷要找誰簽。**

- **Given** 審批類型 `purchase.request` 的 handler 規定金額 ≥ 50,000 時加上「財務」關
- **When** 我送出 80,000 元的申請
- **Then** 申請依序經過「部門主管」→「財務」兩關；主管核准後，財務群組的成員才收到待審通知

**作為財務，我希望會簽要兩個人同意才通過，以便大額支出不是一個人說了算。**

- **Given** 「財務」關設定為 2／N 同意
- **When** 第一位財務核准
- **Then** 申請仍停在這一關、顯示「1／2」；第二位核准後才進入 `handler.apply`

## 初步構想

- 資料模型（租戶 DB）：
  - `approval_requests` 加 `current_step`（`null` = 單關的舊行為）。
  - 新表 `approval_steps`：`request_id`、`ordinal`、`name`、`assignee`（`{ kind: 'user' | 'group' | 'role', id }`）、`required_approvals`、`status`。
  - 新表 `approval_decisions`：`step_id`、`reviewer_id`、`reviewer_name`（快照）、`decision`、`comment`、`decided_at`；`unique(step_id, reviewer_id)`。
- 後端：`ApprovalHandler` 加選用的 `steps(payload): StepDefinition[]`；沒實作的 handler 等同一關、審核者為所有 `approval:review`。
  - 每一關的「有沒有資格審」：`approval:review` ＋ 是該關的審核者（群組成員以關係圖展開）；**核准最後一關時** 仍要 handler 的 `requiredPermissions()`（核准等同代為執行，§3.2）。
  - 四眼原則套到每一關；同一個人能不能審兩關見開放問題 3。
  - 最後一關達到門檻時才進入現有的 §3.4 交易（`handler.apply`）；中間的關卡只寫 decision、推進 `current_step`、通知下一關。
- 前端：`features/approval` 的詳情頁加關卡時間軸；列表加「待我審核」篩選。
- 權限：沿用 `approval:read`、`approval:review`，不新增。
- 稽核：`approval.stepApprove`、`approval.stepReject`（metadata：關卡序號、名稱）；最終的 `approval.approve` 不變。
- 通知：進入新關卡時通知該關的審核者（`approval.pending` 帶關卡名稱）。

## 開放問題

1. 關卡定義放在 handler（程式），還是讓租戶管理者在畫面上設定？前者簡單、可測；後者是客戶常要的，但等於要做一個小型流程設定器。
2. 「申請人的主管」需要組織架構（上下級），系統現在沒有。要不要另開「組織架構」提案，還是第一版只支援群組／角色／指定人？
3. 同一個人同時在兩關的審核者裡，能不能連審兩關？
4. 申請送出後若關卡的審核者名單變了（群組成員異動），以送出當下為準還是即時展開？
5. 中途駁回後，申請人能不能修改後重送同一筆（保留前面的意見），還是一律新開一筆？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/rbac/06-approval.md`（新增「多階段」章節與設計決策）
- 前端：`docs/architecture/frontend/` 審批頁的對應章節
