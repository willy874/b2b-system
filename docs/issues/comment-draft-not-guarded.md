# 輸入中的留言離開頁面時沒有提醒，直接遺失

## 現況

`apps/backstage/src/features/comment/components/CommentEditor.tsx` 第 67–68 行以 `useState` 保存內文與提及的人，整個元件沒有 `useUnsavedChangesGuard`（也沒有 `useFormDraft`）。編輯器出現在資源頁的留言面板（`CommentPanel.tsx` 的新留言、`CommentItem.tsx` 的就地編輯）。

打了一段留言還沒送出就點側欄換頁、重新整理或關分頁，內容直接消失，沒有「要放棄變更嗎？」的確認。backstage 有 24 個檔案用了 `useUnsavedChangesGuard`（webhook、公告、使用者、角色等表單）。

規格方面：`docs/architecture/frontend/09-state-and-storage.md` §4.4 的「session 結束時的草稿」（`useFormDraft`）是**逐一選擇加入**、清單沒有留言，所以那部分不算缺漏；但 §6.2 的未儲存保護（`useUnsavedChangesGuard`）是一般表單的做法，`frontend/22-comment.md` 也沒有說留言不需要。

## 影響

長的留言（尤其是審批、提及多人時）一不小心就要重打。

嚴重度低：體驗問題，不影響資料正確性。

## 修正方式

- `CommentEditor` 算 `dirty = body.trim() !== initialBody.trim() || 提及的人有變`，呼叫 `useUnsavedChangesGuard(dirty)`；送出成功清空後自然解除。
- 同一頁可能同時有新留言與就地編輯兩個編輯器，各自的 blocker 會連續問兩次；若在意，改由 `CommentPanel` 彙整各編輯器的 dirty 後呼叫一次。
- 是否加入 `useFormDraft` 另行決定（加入的話同步更新 §4.4 的表單清單）。

## 驗證方式

- `CommentEditor` 測試補：輸入內容後觸發換頁會出現確認；清空或送出成功後不再攔截。

（2026-10-10 backstage 各功能的優化分析發現。）
