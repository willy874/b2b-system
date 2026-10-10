# 組織圖的編輯模式以最新的部門樹算計畫，會刪掉別人新建的部門、改回別人改的名稱

## 現況

- `apps/backstage/src/features/organization/hooks/useOrgChartEditor.ts` 第 40–44 行：`plan` 是 `planOrgChartChanges(units, draft)`，`units` 是 **目前查詢裡最新的** 部門樹，不是進入編輯模式那一刻的樹；`start()`（第 58–61 行）只把當時的樹複製成 `draft`，沒有另外存下基準。
- 編輯期間部門樹會被換掉：`apps/backstage/src/apis/resources.ts` 第 342–350 行 `Resource.ORG_UNIT` 的推播讓 `ORG_UNIT_TREE_QUERY_KEY` 整批失效重抓；`packages/web-core/src/cache/queryClient.ts` 第 9 行預設 `refetchOnWindowFocus: true`，切回分頁也會重抓。
- `apps/backstage/src/features/organization/pages/Organization/orgChart.ts`：
  - 第 151–155 行：`deletes` 是「在 `units` 裡、但不在草稿裡」的部門——別人在編輯期間新建的部門不在草稿裡，會被排進刪除。
  - 第 137–145 行：改名與搬移以 `units` 的名稱、上層比較——別人改過的名稱或上層與草稿（舊值）不同，會被排成「改名回舊名」「搬回原處」。
  - 第 208 行：`executeOrgChartPlan` 的 `version` 取自同一份最新的 `units`，所以改名、搬移帶的是別人改過之後的版本，樂觀鎖（`ORG_UNIT_VERSION_CONFLICT`）擋不到；刪除（第 184 行 `remove(id)`）本來就不帶版本。

規格 `docs/architecture/backend/23-organization.md` §8.1 只寫「儲存比對草稿與伺服器上的樹」，沒有處理編輯期間伺服器的樹改變。對照 `apps/backstage/src/features/approval-flow/hooks/useApprovalFlowDraft.ts` 第 8–11 行：第一次改動時複製一份，`version` 停在開始編輯的那一版，別人存過就會 409。

## 影響

A 進入組織圖的編輯模式；這段時間 B 在列表頁新增了一個沒有下層的部門「新專案組」、把「業務部」改名為「業務一部」。推播讓 A 的部門樹重抓：

- A 的變更數立刻多出兩筆（`isDirty` 變成 true，即使 A 什麼都還沒改），儲存時「新專案組」被刪除（進回收桶）、「業務一部」被改回「業務部」，且都不會 409。
- 若 B 搬移了部門，A 儲存時會把它搬回去。

嚴重度高：靜默覆寫、刪除他人的資料，樂觀鎖失效。

## 修正方式

1. `useOrgChartEditor` 在 `start()` 時同時存下 `base`（當時的 `units` 快照），`planOrgChartChanges(base, draft)` 與 `executeOrgChartPlan(plan, base, draft, API)` 都以 `base` 計算：沒動到的部門不會出現在計畫裡，`version` 停在進入編輯時的版本，別人改過的改名、搬移會 409。
2. 刪除沒有版本：儲存前比對 `base` 與目前的 `units`，被刪的部門若在伺服器上的 `version` 已改變（或有新的下層），停下並提示「部門樹已被其他人修改，請重新載入」；也可以在編輯期間偵測 `units` 與 `base` 不同時顯示提示列（與 `VersionConflictAlert` 一致的文案），讓使用者選擇放棄草稿重新進入。
3. 儲存失敗是 409 時，`failure` 的說明指出「有人在你編輯時改了這個部門」，畫面回到伺服器的最新狀態（現有的流程）。
4. 規格 §8.1 補一句編輯期間伺服器的樹改變時的行為。

## 驗證方式

- 單元（`orgChart.ts` 的測試）：`planOrgChartChanges(base, draft)` 在 `units` 多一個部門、名稱改變時不產生刪除與改名。
- hook 測試（`useOrgChartEditor`）：`start()` 後以新的 `units`（多一個部門、某個部門名稱與 `version` 改變）重新渲染，`changeCount` 仍是 0、`isDirty` 為 false；改名該部門後儲存，送出的 `version` 是進入編輯時的版本。
- 整合不必改（後端的樂觀鎖已有測試）。
- E2E（選配）：兩個 context，A 進入編輯模式，B 以 API 新增部門並觸發推播，A 儲存後 B 的部門仍在。

（2026-10-10 backstage 各功能的優化分析發現。）
