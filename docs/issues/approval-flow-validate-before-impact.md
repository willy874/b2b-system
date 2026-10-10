# 審批流程的「儲存影響」確認排在前端驗證之前

## 現況

- `apps/backstage/src/features/approval-flow/pages/ApprovalFlowEdit/useSaveWithImpacts.ts` 第 22–40 行：有影響（進行中的申請、啟用或停用）時先 `confirm(...)`，確認後才呼叫 `submit()`。
- `useApprovalFlowEditor.ts` 第 56–60 行：`submit()` 裡才 `setAttempted(true)` 並以 `toPutRequest` 驗證草稿，不通過就回傳 `false`。

所以草稿有錯（例如關卡沒選審核者）時，使用者先看到「進行中的 N 筆照送出時的版本……」的確認，按了「儲存」之後才看到欄位標紅、什麼都沒存。

## 影響

使用者確認了一個實際不會發生的儲存；修正錯誤後再按儲存又要確認一次。

嚴重度低：不會存入錯誤的資料，只是流程順序。

## 修正方式

把驗證拆出來先跑：`useApprovalFlowEditor` 另外回傳 `validate(): boolean`（`setAttempted(true)` ＋ `toPutRequest` 是否非 null），`useSaveWithImpacts` 在算影響之前先呼叫，不通過就直接回傳 `false`、不開確認。`submit()` 內的驗證保留作為保險。

## 驗證方式

- `ApprovalFlowEdit` 的測試補：有 `inFlightCount` 且草稿不完整時按儲存，不出現 `approval-flow-save-confirm`、欄位顯示錯誤、沒有送出請求；草稿完整時照常先確認。

（2026-10-10 backstage 各功能的優化分析發現。）
