# 審批與圖片的留言、提及、關注通知把資源類型顯示成「項目」

## 現況

- `apps/backstage/src/features/comment/constants.ts` 第 4–10 行：能留言與關注的資源是 `user`、`galleryItem`、`approval`（後端 `docs/architecture/backend/24-comment.md` §1 登記的類型）。
- `apps/api/src/modules/comment/comment.notifications.ts` 第 9–25 行：留言、提及與關注的通知在 `params.resourceType` 帶資源類型，讓前端選句子裡的名詞。
- `apps/backstage/src/features/notification/constants.ts` 第 61–64 行：`RESOURCE_TYPE_LABEL_KEY` 只有 `user`，型別是 `Partial<Record<string, string>>`，少了也不會編譯失敗。`adapter.ts` 第 90 行查不到時退回 `RESOURCE_TYPE_FALLBACK_KEY`。
- 兩個語系檔 `apps/backstage/src/features/notification/locales/zh_TW.json` 第 55–58 行、`en_US.json` 第 59–62 行的 `notification.resourceType` 只有 `user` 與 `unknown`（「項目」／「item」）。

## 影響

`notification.title.commentMentioned`「在{{resourceType}}「{{name}}」的留言中提及了你」、`commentCreated`、`watchResourceUpdated` 對審批與圖片顯示成「在項目「…」的留言中提及了你」「你關注的項目「…」有新留言」。通知中心與彈出提示都是這個文字，使用者看不出是審批還是圖片。

嚴重度中：與規格（`params.resourceType` 讓前端選名詞）不一致，連結與內容正確，只是名詞錯。

## 修正方式

1. `RESOURCE_TYPE_LABEL_KEY` 補 `galleryItem`、`approval`，型別改成 `satisfies Record<CommentableResourceType, string>`（`CommentableResourceType` 從 `@/apis/comment/types` 匯入，不 import `features/comment`——feature 之間不互相 import）；後端新增可留言的類型、SDK 重產後這裡沒跟上就編譯失敗。查表時仍保留 fallback（舊通知、後端比前端新）。
2. 兩個語系檔加 `notification.resourceType.galleryItem`（「圖片」／「image」）、`approval`（「審批」／「approval request」）。
3. 若 `CommentableResourceType` 不是由 SDK 產生的聯集，改由 openapi 的 enum 產生，避免前端的常數與後端脫節。

## 驗證方式

- 單元（`features/notification/__tests__/`）：對 `CommentableResourceType` 的每個值，`RESOURCE_TYPE_LABEL_KEY` 都有對應、且 key 在兩個語系檔都存在（讀 JSON 比對，與其他語系完整性測試同一種寫法）。
- adapter 測試：`commentMentioned` 帶 `resourceType: 'approval'`、`'galleryItem'` 時標題裡是「審批」「圖片」，不認得的類型仍是「項目」。

（2026-10-10 backstage 各功能的優化分析發現。）
