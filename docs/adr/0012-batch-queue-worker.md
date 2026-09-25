# ADR-0012 — 批次操作改為前端全域佇列：逐筆呼叫單筆 API，SharedWorker 排程

- 狀態：**採用**（取代 [ADR-0009](./0009-table-batch-operations.md)）
- 日期：2026-09-25
- 相關：[`../architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.2、[`../architecture/frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §5、[`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §10

## 背景

[ADR-0009](./0009-table-batch-operations.md) 為每種批次操作各開了一個後端端點（`POST /<resources>/batch-<action>`），
一次請求處理一批。實際使用後的問題：

- **每多一種批次操作，就要多一個端點**：DTO、controller、service 的 `xxxMany`、route-audit、OpenAPI、SDK、MSW 各一份，
  而單筆端點早就有完整的檢查與副作用。為了共用檢查，單筆 service 被拆成 prepare → apply → publish，變得難讀。
- **一次請求處理 200 筆**：使用者看不到進度，只能等整批回來；請求逾時或中斷時，已提交的筆數不明。
- **批次只活在發起的頁面**：換頁、關掉分頁，結果就沒了；其他分頁也不知道有批次正在跑。

## 決定

| # | 問題 | 決定 |
| --- | --- | --- |
| D1 | 批次由誰處理 | **前端逐筆呼叫一般（單筆）API**；後端不再提供任何批次端點 |
| D2 | 同時處理幾筆 | **堵塞式**：整個佇列同一時間只處理一筆，前一筆有結果才送下一筆；多個工作依送出順序排隊 |
| D3 | 佇列放在哪裡 | **SharedWorker**（同源的所有分頁共用一個佇列）；不支援時退回主執行緒開的 **dedicated worker**（每個分頁一個佇列）；連 Worker 都沒有時（測試）跑在主執行緒 |
| D4 | HTTP 請求由誰送出 | **分頁**。佇列把「這一筆」交給一個分頁（`execute`），分頁以 `apis/` 的一般 fetcher 送出、回報結果。token、續期單飛、錯誤轉換都只在分頁的 `apis/` 一處；access token 不離開分頁的記憶體（[ADR-0004](./0004-jwt-with-rotating-refresh-token.md)） |
| D5 | 由哪個分頁執行 | 優先發起的分頁；它關掉了（`bye`、或 Web Locks 偵測到分頁消失）就交給任一個還在的分頁——每個 feature 在 plugin 的同步階段註冊操作（`registerBatchOperation`），所有分頁都認得 |
| D6 | 進度怎麼讓畫面知道 | 佇列經 **Channel `batch-queue`**（BroadcastChannel）廣播狀態快照；任何分頁（包括連到另一個 dedicated worker 的分頁）都看得到全部工作 |
| D7 | 每筆結果 | 成功或失敗都回報給佇列並記進工作（失敗帶可序列化的錯誤碼）；進度條即時更新，執行的分頁照單筆 mutation 的規則失效快取 |
| D8 | 結束時 | **不論成功或失敗都彈出結果**，只在一個分頁（發起的分頁；它關掉了才給其他分頁）：全部成功 → 成功 toast；有失敗 → 結果對話框逐筆列出原因；取消 → 資訊 toast |
| D9 | 列表的 UI | 勾選後的操作列（`BatchActionBar`）不變；這張表送出的工作進行中時，**操作列換成進度條**（`BatchProgressBar`），在任何分頁打開這張表都看得到 |
| D10 | 全域追蹤 | AppHeader 的佇列按鈕（徽章 = 進行中的工作數）隨時打開面板：所有工作的進度、取消、查看失敗、移除／清除已結束 |
| D11 | 一次的上限 | 不設上限（沒有請求大小的限制了）；逐筆處理，量大只是時間長 |
| D12 | session 結束 | 取消所有進行中的工作——之後的每一筆都只會得到 401 |

### 通道

| 通道 | 方向 | 內容 |
| ---- | ---- | ---- |
| port（SharedWorker 的 `MessagePort`、dedicated worker 本身） | 分頁 ⇄ 佇列 | `hello` / `bye`、`enqueue`、`cancel`、`dismiss`；佇列交派 `execute`、分頁回 `result`；結束通知 `finished` |
| Channel `batch-queue` | 佇列 → 所有分頁 | `snapshot`（帶 `version`，晚到的舊快照略過）；分頁加入時送 `snapshot-request`；dedicated worker 的分頁關閉時送 `host-closed` |

## 理由

- **單筆端點已經是規則的唯一來源**：權限、業務檢查、稽核、快取失效、推播都在那裡。逐筆呼叫它，批次就不會與單筆行為分歧，
  後端也不必為批次拆 service。
- **逐筆＝天然的進度與部分成功**：每筆各自成功或失敗，進度就是「已處理幾筆」，不需要整批的交易語意。
- **「同一批裡前一筆影響後一筆」（例：最後一位 super-admin）照樣正確**：堵塞式逐筆送出，後一筆送出時前一筆已提交。
- **SharedWorker 讓佇列不屬於任何一個頁面**：換頁、關掉發起的分頁都不中斷；所有分頁看到同一份進度。
- **為什麼不讓 worker 自己打 API**：worker 拿不到分頁記憶體裡的 access token；讓它自己續期會與分頁的續期搶用輪替的
  refresh token（被判定為重用 → 整條家族被撤銷）。把請求留在分頁，攔截器鏈、續期單飛、錯誤轉換、MSW 都不必在 worker 裡再做一份。

## 取捨

- **比一次請求慢**：N 筆就是 N 個請求、依序等待。後台管理的批次量不大，換來的是進度可見與行為一致。
- **執行仍需要至少一個分頁開著**：所有分頁都關掉時 SharedWorker 會被瀏覽器結束，剩下的項目不會處理（沒有伺服器端排程）。
- **執行中的分頁消失時，同一筆會交給其他分頁重送**：若前一次其實已經送達，重送會得到 `*_NOT_FOUND` 等錯誤；
  結果清單會列出來，選取也會把「已不存在」的列移出。
- **dedicated worker 模式下佇列屬於單一分頁**：分頁關掉，它的佇列就消失（其他分頁經 `host-closed` 移除它的工作）；
  跨分頁只共享「看得到進度」，不共享執行。

## 後果

- 後端移除 `POST /users/batch-delete`、`/users/batch-unlock`、`/users/batch-status`、`/roles/batch-delete`、
  `/approvals/batch-approve`、`/approvals/batch-reject` 與 `core/batch`（`runBatch`、`BatchIdsSchema`、`BatchResultSchema`）、
  稽核的 `metadata.batch`；單筆 service 回到原本的形狀。
- 前端 `core/batch` 改為佇列（`BatchQueueHost` / `BatchQueueClient` / `connectBatchQueue` / worker 入口）與 UI
  （`BatchProgressBar`、`BatchQueueIndicator`、`BatchQueueNotifier`、`BatchResultDialog`）；`useBatchRunner` 與 `apis/*/batch-*` 移除。
- feature 以 `features/<name>/batch.ts` 註冊操作（每筆呼叫單筆 fetcher ＋ 失效快取、不發 toast），
  列表的 `BatchAction` 以 `operation` 引用它，`RichTable` 的 `batch` 多了 `scope`（這張表在佇列裡的識別）。
