# 已知問題（Known Issues）

這個資料夾放 **已經存在、但還沒修的問題**：程式與文件不一致、測試環境的脆弱點、遷移後留下的過渡程式碼。
一個問題一份文件。它和 [`../features/`](../features/README.md) 的差別：

| | `features/` | `issues/` |
| --- | --- | --- |
| 內容 | 還沒做的 **新功能** | 現有程式 **已經存在的問題** |
| 做完之後 | 提案刪除，改寫成正式文件歸檔 | 文件刪除；修正若改變了行為，同步更新對應的正式文件 |

> 和 `features/` 一樣，這裡的內容不是規格。正式文件（`architecture/`、`conventions/`）描述的是「應該怎樣」；
> 程式碼沒做到時，在這裡記一筆，而不是把正式文件改成配合錯誤的現況。

---

## 1. 清單

| 嚴重度 | 問題 | 文件 | 發現於 |
| --- | --- | --- | --- |
| 中 | E2E 在 api 跑著時重灌資料庫：系統資料夾與個人資料夾不會建立，依賴它們的案例時過時不過 | [`e2e-reseed-skips-bootstrap-preparation.md`](./e2e-reseed-skips-bootstrap-preparation.md) | 2026-10-06（補 E2E） |
| 低 | 改密碼後的登出原因可能被 `session.revoked` 推播搶先，登入頁顯示通用訊息而不是「密碼已變更」 | [`password-change-signout-reason-race.md`](./password-change-signout-reason-race.md) | 2026-10-06（補 E2E） |
| 低 | E2E 以錯誤訊息的文字斷言：表單欄位錯誤與登入錯誤沒有帶錯誤碼的 testid | [`e2e-field-error-text-assertions.md`](./e2e-field-error-text-assertions.md) | 2026-10-06（補 E2E） |

嚴重度：

| 嚴重度 | 意思 |
| --- | --- |
| 高 | 影響正確性或安全，要優先處理 |
| 中 | 行為與規格不一致，但目前不造成錯誤結果 |
| 低 | 開發體驗或程式整潔，可以穿插處理 |

---

## 2. 新增一筆

1. 新增 `<kebab-case>.md`，結構：**現況 → 影響 → 修正方式 → 驗證方式**。
   現況要寫到檔案與行號層級，讓處理的人不必重新調查。
2. 在上方 §1 的表格加一列。

## 3. 處理完之後

1. 刪除該問題的文件，以及 §1 表格的那一列。
2. 修正改變了行為或設定時，同步更新正式文件（例如 `architecture/`、`conventions/`）。
3. commit message 的內文提到問題的檔名，方便日後從 git 歷史找回脈絡。
