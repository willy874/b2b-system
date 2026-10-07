# 個資處理：匿名化與個人資料匯出

- 優先度：P3
- 狀態：提案
- 依賴：[`import-export.md`](./import-export.md)（個人資料匯出用同一套背景產檔與下載）
- 相關：[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §3.1（`actorEmail`、`resourceName` 快照）、[`backend/13-trash.md`](../architecture/backend/13-trash.md) §4.2（使用者的永久刪除）、
  [`backend/14-revisions.md`](../architecture/backend/14-revisions.md)（快照裡的個資）、[`backend/12-settings.md`](../architecture/backend/12-settings.md)（現有的各種保留期限）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

各類資料的保留期限多已可調（回收桶、版本、通知、公告發送紀錄、稽核冷熱表；[`backend/12-settings.md`](../architecture/backend/12-settings.md)、[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3）。
缺的是「針對一個人」的處理：

- **被遺忘權**：使用者永久刪除後，稽核仍保留 `actorEmail` 快照（刻意的，[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §3.1），而稽核是 append-only（DB 角色沒有 UPDATE）。
  版本快照、審批的名稱快照、通知內容也可能有姓名與 email。
- **個人資料查閱**：客戶的使用者要求「我在系統裡有哪些資料」，現在要工程師手動查。

B2B 客戶簽約時常被要求說明這兩件事怎麼做。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 匿名化一個使用者：帳號資料清空、稽核與快照中的身分改為假名 | 自動化的法規流程（工單、期限追蹤） |
| 匯出一個使用者的個人資料（帳號、角色、群組、登入紀錄、他產生的資源清單） | 業務資料的個資欄位標記（等業務功能出現再擴充） |
| 擁有者模組登記「這裡有個資」的 handler（與 `TrashHandler` 同一種形狀） | |

## 使用者故事

**作為租戶管理者，我希望匿名化一位已離職且要求刪除資料的員工，以便符合個資法規，同時稽核仍然完整。**

- **Given** 使用者 U 已刪除
- **When** 我執行「匿名化」並確認
- **Then** U 的 email、姓名在帳號、版本快照、審批快照中被替換成 `deleted-user-<短碼>`；稽核紀錄的數量與時間不變，顯示的身分變成同一個假名

## 初步構想

- 稽核 append-only 的處理（見開放問題 1）：稽核改存 `actor_id` 與 **假名對照表**（`subject_aliases`），快照只在對照表；匿名化 = 刪除對照表的真名。
  這會改動現有的寫入格式，需要評估既有資料的遷移。
- 後端：`modules/privacy`：`PersonalDataHandler { anonymize(userId, tx), export(userId) }`，擁有者在 `onModuleInit` 登記。
- 匯出走 [`import-export.md`](./import-export.md) 的 `Exporter`。
- 權限：`user:anonymize`（新增，獨立於 `user:delete`）、`user:exportPersonalData`。
- 稽核：`user.anonymize`（不記被移除的內容）。

## 開放問題

1. 稽核的身分要怎麼匿名化而不破壞 append-only？（假名對照表、或由專用的 DB 角色以受控函式更新快照欄位）
2. 匿名化是否必須先經過審批（四眼）？
3. 冷表（已壓縮的月份分區）裡的快照怎麼處理？
4. 物件儲存裡使用者上傳的檔案算不算這個範圍？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/backend/NN-privacy.md`（含設計決策）
- `docs/architecture/backend/06-audit-log.md`（若改變稽核的身分儲存）
