# ADR-0002 — UI 採用 Base UI 而非 MUI

- 狀態：**提案中（待確認）**
- 日期：2026-09-19
- 相關：[`../architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md)

## 背景

同類型管理後台的常見作法是 MUI ＋ 一層薄封裝。使用者明確要求本專案改用 Base UI。
本 ADR 記錄這個決定的理由與代價，確保後續不會有人想「改回 MUI 比較快」。

## 決定

- UI 基礎採用 **Base UI**（`@base-ui/react` 1.x）
- `src/components/` 是完整的設計系統實作層，不是薄封裝
- 樣式來自 `src/themes/` 的三層 CSS 變數 ＋ UnoCSS 的排版工具類
- Base UI 沒有的元件（Table、Pagination、DatePicker、Breadcrumbs…）自己實作

## 理由

1. **Game Editor 會有大量非標準 UI。** 畫布、屬性面板、時間軸、資源樹——
   一套 opinionated 的視覺設計在這些場景是要對抗的對象，不是助力。
2. **Base UI 提供的正是我們要的那一半。** 焦點管理、鍵盤互動、ARIA、彈層定位
   ——這些自己寫既難又容易出錯。視覺則本來就要自己決定。
3. **與 UnoCSS 天然契合。** MUI 帶 Emotion，等於同時跑兩套樣式引擎，
   要處理優先序與 SSR 順序問題。Base UI 只吃 `className`。
4. **bundle 更小。** Base UI 沒有樣式引擎與整套設計系統。
5. **狀態透過 `data-*` 屬性暴露**，樣式可以純 CSS 表達，不需要在 React 裡算
   className。

## 代價

| 代價                                   | 評估                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| **`components/` 的初期工作量大幅增加** | 這是主要代價。約 20 個元件要從零寫樣式。排入 [`../overview/03-roadmap.md`](../overview/03-roadmap.md) M1–M2 |
| Table / DatePicker 等要自己做          | Table 用 TanStack Table（本來就要用）；DatePicker 是 M2 的一整項工作                |
| 沒有現成的視覺參考                     | 需要先定 Design Token 與元件規格，不能邊做邊想                                      |
| 社群範例比 MUI 少                      | Base UI 文件完整；且它的 API 面比 MUI 小得多                                        |

## 替代方案

| 方案                   | 不採用的理由                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------- |
| MUI                    | 使用者明確要求不用；且與 UnoCSS 衝突                                                    |
| Radix UI               | 與 Base UI 定位相同。Base UI 由 MUI 團隊維護，API 風格與團隊既有經驗較接近，且 v1 已 GA |
| shadcn/ui              | 它是 Radix ＋ Tailwind 的複製貼上範本，不是函式庫。可作為樣式參考，但不作為相依         |
| 全部自己寫（含可近性） | 焦點陷阱、roving tabindex、彈層定位自己寫的成本遠高於學一套 API                         |
