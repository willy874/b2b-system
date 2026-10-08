# 匯入分析的 worker 池：worker 掛掉或程序關閉時，排隊中的請求沒有被處理

## 現況

`apps/api/src/modules/data-transfer/import/parse-pool.ts`（[`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md) §7.3、§13 D22）。

1. **worker 掛掉時，排隊者沒有接手**
   - `spawn()` 的 `exit` handler（114–120 行）先把 slot 從 `slots` 移除，再拒絕手上的請求。
   - 該請求的 `parse()` 在 `finally` 呼叫 `release(slot)`（56 行），但 `release` 第一行（91 行）
     `if (!this.slots.includes(slot)) return;`，排隊中的請求不會被叫醒，也不會補一個新的 worker。
   - 重現：`DATA_TRANSFER_PARSE_WORKERS=1`，A 正在解析、B 在排隊；A 的 worker 以非 0 結束（沒有先觸發 `error`）。
     預期 B 立刻拿到新建立的 worker；實際 B 等滿 `DATA_TRANSFER_PARSE_QUEUE_TIMEOUT_MS`（5 秒）後收到 `503 DATA_TRANSFER_BUSY`，池子其實有空位。
   - 若 worker 先觸發 `error`（110–113 行）：A 的 `finally` 在 `exit` 之前執行，slot 還在 `slots` 裡，
     `release` 會把這個 **已經壞掉的** worker 交給 B；接著 `exit` 把 B 的請求以「worker thread 結束」拒絕。
     B 拿到的是錯誤，而不是新的 worker。
2. **程序關閉時，排隊者的 promise 永遠不會結束**
   - `onModuleDestroy()`（60–64 行）對 `waiting` 只 `clearTimeout`，沒有 reject。
   - 關閉期間還在排隊的 `parse()` 不會 resolve 也不會 reject。

## 影響

- 1：worker 異常結束很少見（OOM、原生模組崩潰），發生時排隊中的匯入分析多等 5 秒才失敗，或直接失敗；
  使用者看到「忙碌中，稍後重試」，重試即可。不影響資料正確性。
- 2：只在程序關閉時，請求本來就會被中斷；但懸著的 promise 讓 graceful shutdown 等不到該請求結束。

嚴重度：中（行為與規格 §7.3「worker 掛掉時拒絕它手上的請求並補一個新的」不一致，但不造成錯誤資料）。

## 修正方式

- `exit`（與 `error`）時把 slot 標成不可用；`release` 遇到已移除或壞掉的 slot 時，若有排隊者就 `spawn()` 一個新的交給它。
- `onModuleDestroy()` 對每個排隊者 `reject(new AppException('DATA_TRANSFER_BUSY'))`；`waiting` 的元素需要保存 `reject`。

## 驗證方式

`apps/api/src/modules/data-transfer/__tests__/parse-pool.spec.ts`（已用假的 `Worker` 模擬事件）加三個案例：

- size=1、A 解析中、B 排隊；A 的 worker `exit(1)` → B 立刻在新 worker 上解析成功，不等 5 秒（fake timers 不前進）。
- 同上，但先 `error` 再 `exit(1)` → B 不會拿到壞掉的 worker。
- 有排隊者時 `onModuleDestroy()` → 排隊的 `parse()` 以 `DATA_TRANSFER_BUSY` 拒絕。

（2026-10-08 補單元測試時由 `parse-pool.spec.ts` 的撰寫發現。）
