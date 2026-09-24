# 寫程式規範

`architecture/` 描述系統 **長什麼樣子**；這裡描述寫程式時 **每天要遵守的規則**。
兩者衝突時以 `architecture/` 為準，並回頭修正這裡。

## 章節

| #   | 檔案                                   | 內容                                                   |
| --- | -------------------------------------- | ------------------------------------------------------ |
| 01  | [`01-general.md`](./01-general.md)     | TypeScript、命名、匯入、註解、錯誤處理（前後端共通）   |
| 02  | [`02-frontend.md`](./02-frontend.md)   | 前端分層規則、feature / 元件 / hook / 樣式的寫法       |
| 03  | [`03-backend.md`](./03-backend.md)     | 後端分層規則、Controller / Service / Repository、交易  |
| 04  | [`04-testing.md`](./04-testing.md)     | 測試檔位置與命名、該寫哪一層、必備案例                 |
| 05  | [`05-git.md`](./05-git.md)             | branch、commit message、PR 檢查清單                    |
| 06  | [`06-literal-strings.md`](./06-literal-strings.md) | i18n key、className、`data-testid` 不得以字串模板組成 |
| 07  | [`07-layer-dependencies.md`](./07-layer-dependencies.md) | package 與資料夾的層級依賴矩陣              |

## 規則的強度

每條規則都標明它靠什麼守住，讓人知道哪些會被機器擋、哪些要靠 review：

| 標記     | 意義                                                           |
| -------- | -------------------------------------------------------------- |
| 🔒 工具  | 由 `tsc` / `oxlint` / `oxfmt` / 啟動檢查 / 測試強制，違反就失敗 |
| 👀 Review | 目前沒有工具擋，靠 code review 把關                             |

新增規則時：能用工具強制的就用工具強制，並把標記從 👀 改成 🔒。

## 新增規則

1. 在本資料夾新增 `NN-<kebab-case>.md`（`NN` 接續最大編號），並加進上方章節表。
2. 規則檔的結構：**規則 → 為什麼 → 寫法（正反例）→ 檢查方式**；
   規則建立時已有違規而未一次修完，再加 **現況（既有違規）** 一節，清完即刪除。
3. 不需要修改 `.claude/skills/best-practice/`——skill 會讀取整個 `docs/conventions/` 資料夾。

## 撰寫慣例

- 規則要附 **理由**；沒有理由的規則會在第一次不方便時被打破。
- 規則要附 **正反例**，反例寫成 `❌ / ✅` 對照表。
- 已在 `architecture/` 詳述的機制只連過去，不在這裡重寫一次。
