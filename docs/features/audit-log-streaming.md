# 稽核日誌串流到 SIEM

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)（寫入、熱冷分層、保留期限）、[`backend/17-webhook.md`](../architecture/backend/17-webhook.md)（投遞、重試、簽章、SSRF 防護）、
  [`import-export.md`](./import-export.md)（一次性的稽核匯出）、[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1（`job_outbox`）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

企業客戶的資安團隊要把所有系統的稽核集中到自己的 SIEM（Splunk、Datadog、Elastic、Sentinel），做跨系統的告警與長期保存。
現在稽核只能在後台的稽核頁看；[`import-export.md`](./import-export.md) 規劃的是 **一次性** 匯出 CSV，不是持續送出。

Webhook 已經有投遞、重試、HMAC 簽章、連續失敗停用與對外連線的 SSRF 防護（[`backend/17-webhook.md`](../architecture/backend/17-webhook.md)），
但它是「業務事件」：一筆稽核不是一個 webhook 事件，量也大得多（每次寫入、每次授權拒絕都有一筆）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶設定一個串流目的地：HTTPS（JSON lines、批次）或 S3 相容 bucket | Syslog（TCP／UDP）、Kafka |
| 稽核寫入後以批次、至少一次送出，帶序號讓接收端去重 | 送出前的過濾與欄位遮蔽（見開放問題 2） |
| 失敗重試、落後量與最後成功時間顯示在設定頁 | 回補「設定之前」的歷史（用一次性匯出） |
| 送出目的地的連線沿用 `core/http/outbound.ts` 的 SSRF 防護 | |

## 使用者故事

**作為客戶的資安人員，我希望後台的每一筆稽核在幾分鐘內出現在我們的 SIEM，以便和其他系統一起告警。**

- **Given** 租戶設定了串流目的地
- **When** 有人在後台修改角色權限
- **Then** 5 分鐘內 SIEM 收到一筆 `role.update`（含操作者、IP、前後差異）；目的地暫時掛掉時，恢復後依序補送，不遺失

## 初步構想

- 不用每筆入列：背景工作 `auditLog.stream`（每分鐘）以 **游標**（最後送出的稽核 id 或時間＋id）從熱表讀下一批送出，成功後推進游標。
  熱表保留期限（`auditLog.hotRetentionDays`）遠大於落後的容忍度；落後超過熱表時告警（見開放問題 3）。
- 資料模型（租戶 DB）：`audit_streams`：`destination`、`config`（加密的密鑰）、`cursor`、`last_success_at`、`consecutive_failures`、`status`、`version`。
- 送出格式：JSON lines，每筆帶 `tenant`、`seq`；HTTPS 目的地帶與 Webhook 同樣的 HMAC 簽章。
- 權限：`auditLog:stream`（新增；能看稽核不代表可以把它整批送到外面，與 [`import-export.md`](./import-export.md) 開放問題 3 同一個考量）。
- 指標：落後筆數、送出失敗數（`core/metrics/instruments.ts`，不帶租戶標籤）。
- 稽核：設定的變更（`auditStream.create`／`update`／`delete`）。

## 開放問題

1. 與 Webhook 合併成「一種特殊的訂閱」還是獨立模組？共用投遞層（`webhook.transport.ts`）就好？
2. 要不要讓租戶過濾（只送授權拒絕）或遮蔽欄位（IP）？
3. 落後超過熱表保留期限時，要從冷表補還是放棄並告警？
4. 要不要是可由平台關閉的 feature（只有某些方案有）？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/backend/06-audit-log.md`（新增「串流」章節與設計決策）
