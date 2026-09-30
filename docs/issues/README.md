# 全面檢查報告（2026-09-30）

以「企業多租戶、1000 人同時在線」為前提，對整個 repo 做的一次性檢查。
每份報告的發現都附檔案與行號、影響、建議與驗收方式；標「待驗證」的是讀程式碼推論、尚未實測的項目。

| 報告 | 範圍 | P0 | P1 | P2 | P3 | 合計 |
| --- | --- | --- | --- | --- | --- | --- |
| [01-performance.md](./01-performance.md) | DB、快取、realtime、背景工作、nginx、前端產物 | 2 | 6 | 8 | 5 | 21 |
| [02-security.md](./02-security.md) | 認證、OIDC／外部 IdP、授權、租戶隔離、檔案、部署 | 1 | 2 | 7 | 9 | 19 |
| [03-edge-cases.md](./03-edge-cases.md) | 併發競態、自我操作、刪除參照、輸入邊界、租戶生命週期 | 2 | 6 | 8 | 10 | 26 |
| [04-user-experience.md](./04-user-experience.md) | 狀態回饋、錯誤訊息、i18n、表單、a11y、權限體驗 | 2 | 15 | 13 | 6 | 36 |

嚴重度：**P0** 上線前必修；**P1** 高；**P2** 中；**P3** 低／強化。

## 跨報告的重複項目

同一個根因被多份報告從不同角度發現，修一次即可：

| 根因 | 相關 ID |
| --- | --- |
| 租戶帳號鎖定後 `status` 永遠停在 `locked`，任何人輸錯 5 次就能永久鎖住任意帳號 | SEC-03、EDGE-01（登入失敗計數的併發少算另見 EDGE-05） |
| 速率限制只以 IP 計、存在記憶體，企業 NAT 後的整間公司共用額度 | PERF-01、SEC-06、EDGE-04、UX-31 |
| 權限較低的 admin 可以停用／刪除／拔掉 super-admin；「最後一位」檢查有競態 | SEC-07、EDGE-08、EDGE-03 |
| 租戶網域快取沒有上限，未命中也在 throttler 之前查平台 DB | PERF-12、SEC-05 |
| 事件匯流排全程序單一序列，`refreshAudience` 逐人查 DB，跨租戶互相阻塞 | PERF-08、EDGE-15 |
| 一次性 token 的「檢查 → 消耗」不是原子操作 | SEC-12、EDGE-23 |
| 外部 IdP 以 email 連結帳號（接管風險、刪除後不清連結） | SEC-01、EDGE-06 |
| 沒有「未儲存離開」提醒 | UX-17、EDGE-26 |

## 建議修正順序

**第一批：上線前必修（安全與資料正確性）**

1. SEC-01：外部 IdP 自動連結限定已登記網域，並排除特權帳號（或改成需登入後手動連結）。
2. SEC-03／EDGE-01／EDGE-05：鎖定改為只看 `lockedUntil`，狀態檢查移到密碼驗證之後，失敗計數改為原子遞增。
3. EDGE-02：啟用 token 消耗時檢查使用者目前仍是 `pending`。
4. SEC-02：`/storage` 一律 `Content-Disposition: attachment`＋`X-Content-Type-Options: nosniff`，或改由獨立網域提供。
5. SEC-07／EDGE-08／EDGE-03：操作 super-admin 需要本身是 super-admin；「最後一位」檢查放進交易並加鎖。
6. UX-02、UX-01：權限對話框在資料載入前停用；網域移除加確認並禁止移除主網域。

**第二批：撐住 1000 人在線（容量）**

7. PERF-01／SEC-06：限流改以「使用者＋IP」為 key，續期與 WebSocket 的上限可由環境變數調整。
8. PERF-02、PERF-15：nginx 調高 `worker_connections`，加上 upstream keepalive。
9. PERF-03、PERF-16：重新估算連線預算（租戶數 × pool × 程序數 ≤ `max_connections`），加上 `statement_timeout` 與連線池等待逾時。
10. PERF-04：`refresh_tokens` 清理排程，並設定家族的絕對壽命。
11. PERF-05／PERF-06／PERF-08：資料夾樹與推播扇出改為依使用者可見範圍計算；事件處理不在全域序列中逐人查 DB。

**第三批：體驗與強化**

12. UX-03～UX-17：錯誤狀態、Zod 訊息中文化、404／錯誤頁、session 結束的原因說明、未翻譯的錯誤碼（改以 `ErrorCode` 列舉產生測試清單）。
13. 其餘 P2／P3 依模組排入 `docs/features/` 或各自的修正分支。

## 使用方式

- 修正某項時，在該報告對應段落加上 `**狀態**：已修（<commit>）`，全部修完後把該報告移到歸檔或刪除。
- 需要產品決策的項目（EDGE-08 是否刻意允許、UX-33「記住我」、EDGE-25 系統角色可否改名）先確認再動手。
