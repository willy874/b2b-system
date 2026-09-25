# ADR-0009 — 列表的批次操作：後端批次端點、逐筆交易、部分成功

- 狀態：**提案中（待確認）**
- 日期：2026-09-25
- 相關：[`../architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6、[`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md)、[`../rbac/04-api-spec.md`](../rbac/04-api-spec.md)、[ADR-0008](./0008-realtime-with-socket-io.md)

## 背景

表格已經具備批次操作的前半段：

- `createSelectColumn` ＋ `useTableSelection`：跨頁保留勾選，並記住勾選當下的整筆資料（`selectedRows`）。
- `RichTable` 預設就有勾選欄；`TableRow` 在「已勾選至少一列」後，單擊列身會切換選取。

缺的是後半段：選了之後能做什麼。目前每個寫入操作都只有單筆端點，而單筆操作背後有不少規則：

| 操作 | 單筆端點 | 業務檢查 | 交易後的副作用 |
| --- | --- | --- | --- |
| 刪除使用者 | `DELETE /users/:id` | 不能刪自己（`AUTHZ_SELF_MODIFY`）、不能刪最後一位 super-admin（`LAST_SUPER_ADMIN`） | 使用者快取、權限快取失效 → `SESSIONS_REVOKED` ＋ `RESOURCE_CHANGED` |
| 停用／啟用 | `PATCH /users/:id` `{ status }` | 同上（停用時） | 同上；停用還要撤銷 refresh token |
| 解鎖 | `POST /users/:id/unlock` | 必須是 `locked`（`USER_NOT_LOCKED`） | 快取失效 ＋ `RESOURCE_CHANGED` |
| 刪除角色 | `DELETE /roles/:id` | 系統角色（`ROLE_SYSTEM_PROTECTED`，另有 DB trigger）、有人持有（`ROLE_IN_USE`，可 `force`） | 先查受影響的使用者 → 權限快取失效 → `PERMISSIONS_CHANGED` ＋ `RESOURCE_CHANGED` |

其中「最後一位 super-admin」要看目前資料庫的狀態，所以同一批裡的前一筆會影響後一筆的判斷結果。

## 決定

| # | 問題 | 決定 |
| --- | --- | --- |
| D1 | 前端逐筆呼叫，還是由後端提供批次端點 | **後端批次端點**，一次請求處理一批 |
| D2 | 全部成功才算成功，還是允許部分成功 | **逐筆獨立交易、允許部分成功**；每筆回報結果 |
| D3 | 批次內的執行方式 | 依請求中 `ids` 的順序 **依序** 執行（不平行）；每筆都是「檢查 → 交易（含稽核）→ 快取失效」 |
| D4 | 領域事件 | 整批結束後 **合併發佈一次**（一個 `RESOURCE_CHANGED` 帶多筆 `changes`；`SESSIONS_REVOKED` 依 `reason` 各合併一次） |
| D5 | 權限 | **不新增權限鍵**；沿用單筆操作的權限（`user:delete`、`user:update`、`role:delete`） |
| D6 | 端點命名 | `POST /<resources>/batch-<action>`，例如 `POST /users/batch-delete` |
| D7 | 請求與回應格式 | 請求 `{ ids: uuid[] }`（1–200 筆、不可重複，其他參數並列）；回應 `200 { data: { succeeded: string[], failed: { id, code, details? }[] } }` |
| D8 | 稽核 | 每筆一條稽核紀錄（`action` 與單筆相同）；同一批共用 `metadata.requestId`，另加 `metadata.batch: { size }` |
| D9 | 冪等 | 目標已經是結果狀態（例如停用已停用的人）→ 算 **成功**，但不寫稽核、不發事件。單筆本來就會拒絕的情況維持拒絕（解鎖沒被鎖的人 → `USER_NOT_LOCKED`），批次不改變單筆的規則 |
| D10 | 角色批次刪除的 `force` | **不提供**。有人持有的角色一律回報 `ROLE_IN_USE`，要強制刪除請走單筆 |
| D11 | 前端通用元件 | `components/Table/BatchActionBar`（沒有業務名詞，文字由 `labels` 傳入）＋ `RichTable` 的 `batch` prop ＋ `core/batch/useBatchRunner`（確認 → 執行 → 結果） |
| D12 | 前端資格預判 | 每個批次動作以 `isEligible(row)` 預先分出「可執行／會略過」，只把可執行的 id 送出；**後端仍然逐筆完整檢查**，預判只是體驗 |
| D13 | 執行後的選取 | 成功的從選取移除；失敗的保留勾選以便修正後重試，但 `*_NOT_FOUND`（已被別人刪除）一併移除 |
| D14 | 首期範圍 | 使用者：批次刪除、批次解鎖、批次停用／啟用；角色：批次刪除 |
| D15 | 延後 | 批次指派角色、審批單批次核准／駁回（第二期第一順位）、稽核日誌依 `requestId` 篩選（見 §延後項目） |

### D7 的細節

```jsonc
// POST /users/batch-status
{ "ids": ["…", "…"], "status": "inactive" }

// 200
{
  "data": {
    "succeeded": ["…"],
    "failed": [{ "id": "…", "code": "AUTHZ_SELF_MODIFY" }, { "id": "…", "code": "LAST_SUPER_ADMIN" }],
  },
}
```

- 回應順序與請求的 `ids` 順序一致（`succeeded` 與 `failed` 各自保序）。
- **整批層級** 的錯誤照原本的錯誤信封回傳，不進 `failed`：Zod 驗證失敗（`400`）、缺權限（`403`）、速率限制（`429`）。
- 逐筆錯誤只收 `AppException`；非預期例外（DB 斷線等）視為整批失敗，回 `500`——已經提交的那幾筆不會回滾，
  前端重新整理列表即可看到實際狀態（每筆的交易本來就是獨立的）。
- 上限 200 筆＝分頁 `limit` 的上限，讓「在一頁全選」一定送得出去；跨頁累積超過 200 筆時，前端把按鈕停用並提示。

### D3／D4 的實作方式：把單筆方法拆成三段

審批 handler 已經採用這個分法（`assertApprovable` → `apply(tx)` → `afterApply`），批次沿用同一個分法：

```ts
// UserService
async remove(id, actor) {                 // 單筆：行為不變
  const plan = await this.prepareRemove(id, actor);        // 業務檢查，失敗拋 AppException
  await withTransaction(this.db, (tx) => this.applyRemove(plan, actor, tx)); // 寫入 ＋ 稽核
  this.invalidateRemoved([plan]);                          // 快取失效
  this.publishRemoved([plan]);                             // 領域事件
}

async removeMany(ids, actor): Promise<BatchResult> {
  return runBatch(ids, {
    prepare: (id) => this.prepareRemove(id, actor),
    apply: (plan, tx) => this.applyRemove(plan, actor, tx),
    invalidate: (plan) => this.invalidateRemoved([plan]),  // 每筆交易後立刻失效
    publish: (plans) => this.publishRemoved(plans),        // 整批結束後一次
  });
}
```

`runBatch()` 放在 `core/batch/`（不 import `modules/`），負責依序執行、收集 `AppException`、組 `BatchResult`、
在請求 context 帶入 `batch`，由 `AuditService` 寫進稽核 metadata（`core/` 不能 import `modules/`，所以不直接呼叫稽核）。每一筆仍然遵守「稽核在交易內 → 快取失效在交易後 → 事件在快取失效後」
（CLAUDE.md 後端規則 6）；事件只是延後到整批最後才發，順序沒有顛倒。

## 理由

1. **D1 後端端點，而不是前端逐筆打。** 前端逐筆打 200 次會吃掉整個全域速率限制（120 次／分／IP），
   還會觸發 200 次推播、200 次快取失效廣播；網路中斷時也只剩前端知道做到哪一筆。批次端點只算一次請求，
   事件也能合併。
2. **D2 部分成功。** 最常見的情況是「選了一整頁，其中一筆是自己／系統角色」。如果全部成功才算成功，
   使用者要自己找出是哪一筆擋住，再重選一次。逐筆回報讓畫面可以直接列出失敗原因。
   全部成功才算成功還有一個問題：「最後一位 super-admin」要在同一個交易裡依序檢查，
   交易會長到把整批的列都鎖住。
3. **D3 依序執行、不平行。** 「最後一位 super-admin」要看前一筆執行後的狀態；平行執行會讓兩筆同時通過檢查，
   刪光所有 super-admin。依序執行的成本在 200 筆以內可以忽略。
4. **D5 不新增權限。** 批次只是「一次做很多次同一件事」，沒有擴大能做的事。另加 `user:batch-delete`
   會讓權限目錄、seed、前端 `permission.ts`、兩份語系檔都多一組，還會出現「能單筆刪、不能批次刪」這種沒有意義的組合。
5. **D6 用 `batch-<action>`，而不是 `/batch/<action>`。** `POST /users/batch/unlock` 會和
   `POST /users/:id/unlock` 搶同一個路由（`id = "batch"`），結果取決於 controller 的宣告順序。
   扁平的 `batch-unlock` 沒有對應的 `POST /users/:id` 可以撞。也不用 `DELETE /users` 帶 body：
   HTTP 沒有定義 DELETE body 的語意，產生的 SDK 與代理伺服器的支援也不一致。
6. **D8 每筆一條稽核。** 稽核日誌是依資源查的（「這個使用者發生過什麼事」）；一條「批次刪了 30 人」的紀錄
   無法從單一使用者查到。`requestId` 本來就會自動寫入 metadata，同一批天生共用，不必另加 `batchId`。
7. **D10 不提供 `force`。** 強制刪除會一次拔掉很多人的權限，批次再乘上 N 筆，影響範圍太難從確認框看清楚。
   首期先不做，有需要再加（屆時確認框要列出每個角色的持有人數）。
8. **D12 前端預判＋後端再檢查。** 列的 VM 已經算好 `canDelete`、`canUnlock` 等旗標（adapter 裡），
   直接拿來分組，讓確認框能說清楚「30 筆中 2 筆會被略過」；但資料可能是舊的（跨頁快照、別人剛改過），
   所以後端的逐筆檢查才是準。

## 捨棄的方案

| 方案 | 捨棄原因 |
| --- | --- |
| 前端 `Promise.all` 逐筆呼叫單筆端點 | 見理由 1；另外平行呼叫會破壞「最後一位 super-admin」的判斷 |
| 整批一個交易、全部成功才算成功 | 見理由 2 |
| 非同步工作（送出後回 job id，輪詢進度） | 200 筆以內同步處理只要數百毫秒；等到有真正的大量操作（匯入、遊戲資源）再引入 |
| 回 `207 Multi-Status` | 源自 WebDAV，規定主體是逐筆帶狀態碼的 XML 結構；我們的逐筆結果本來就在 `data` 裡，用 `200` 就夠，也不必讓 OpenAPI／SDK 多處理一種成功狀態 |
| `DELETE /users` ＋ body `{ ids }` | 見理由 5 |
| 選取時存「篩選條件」而不是 id（「全選符合條件的 1,234 筆」） | 送出時符合條件的列可能已經變了，使用者確認的和實際執行的不一致。首期只做明確 id |

## 代價

| 代價 | 評估 |
| --- | --- |
| 單筆 service 方法要拆成三段 | 審批 handler 已經是這個形狀，拆完單筆與批次共用同一套檢查，不會寫兩份規則 |
| 一次請求最長要處理 200 個交易 | 每筆只有幾個查詢；逾時風險低，必要時再調降上限 |
| 整批途中發生非預期例外時，前半已提交 | 與單筆連續操作的結果相同；回 500 後前端重新整理列表 |
| 事件延後到整批結束才發 | 其他人的畫面最多晚這一批的執行時間（< 1 秒）才更新 |

## 延後項目

| 項目 | 延後原因 | 前置條件 |
| --- | --- | --- |
| 批次指派／移除角色 | 單筆是 `PUT` 整批取代，批次需要 `{ add, remove }` 差異語意；反提權檢查（`assertRolesAssignable`）要依每個目標重新評估「失去 super-admin」 | 先定義差異語意的端點 |
| 審批單批次核准／駁回 | 首期先把通用機制做穩。前置條件已經滿足：審批列表已有「快速核准」（不指派角色、不附意見），批次核准直接沿用這個語意，要指派角色仍走逐筆審核對話框 | 無；列為第二期第一順位 |
| 稽核日誌依 `requestId` 篩選 | 首期 `requestId` 已經寫入，查詢介面之後再加 | — |
| 角色批次強制刪除 | 見理由 7 | 確認框能列出每個角色的持有人數 |

## 落地時要同步的地方

- `docs/architecture/backend/03-api-conventions.md`：新增「批次端點」一節（D6、D7、D9）
- `docs/rbac/04-api-spec.md`：四個新端點
- `docs/architecture/backend/06-audit-log.md`：`metadata.batch`
- `docs/architecture/frontend/07-ui-system.md` §6：`BatchActionBar`、`RichTable` 的 `batch`、`useBatchRunner`
- `docs/architecture/frontend/06-permission.md` §6：層級 3 的範例改成批次動作的實際寫法
- `apps/api/test/route-audit.spec.ts`、`pnpm openapi:generate && pnpm sdk:generate`
