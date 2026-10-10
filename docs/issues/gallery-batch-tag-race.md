# 圖片庫的批次貼標籤以「先讀再整份取代」實作，與同時的標籤編輯互相覆蓋

## 現況

- `apps/backstage/src/features/gallery/batch.ts` 第 113–131 行（`gallery.tag`）：每一張先 `fetchGalleryItemQuery` 讀目前的標籤（第 122–123 行），加上要貼的那一個，再以 `replaceTags`（`PUT /tags/assignments/galleryItem/:id`）整份取代（第 125–128 行）。讀與寫之間沒有任何版本檢查。
- `apps/api/src/modules/tag/tag.controller.ts` 第 82–94 行：標籤指派只有這一支整批取代的端點；`ReplaceResourceTagsSchema`（`apps/api/src/modules/tag/dto/tag.dto.ts` 第 64–71 行）只有 `tagIds`，沒有 `version` 或預期的舊值。tag 模組沒有「新增一個標籤」或「移除一個標籤」的端點。
- 規格 `docs/architecture/backend/18-tag.md` D7 選擇整批取代（「前端不必為每種資源各做一支端點」），`frontend/24-gallery.md` §5 只寫批次貼標籤經全域批次佇列、項目 id 是 `<圖片 id>@<標籤 id>`，沒有提到並行。

同一個批次工作內不會自己打架：`BatchTagDialog.tsx` 一次只選一個標籤，佇列的預設 `concurrency` 是 1（`packages/web-core/src/batch/BatchQueueHost.ts` 第 242–245 行），工作之間依序執行。競態只發生在批次與 **其他寫入** 之間。

## 影響

批次佇列可能在背景（甚至別的分頁）跑幾百張；這段期間另一個人（或同一人在檢視器的 `GalleryTagDialog`）改了某一張的標籤，若剛好落在批次那一張的 GET 與 PUT 之間，後寫的一方會把另一方的變更蓋掉：檢視器加的標籤消失，或批次加的標籤被檢視器那份舊清單蓋回去。沒有錯誤、沒有提示，只有稽核看得出來。

另外每張圖要兩次請求（GET ＋ PUT），幾百張的批次多一倍的往返。

嚴重度低：時間窗只有一次 GET 到 PUT 的往返，實際撞上的機率小；整批取代本來就是規格選的「最後寫入者勝」語意（檢視器的對話框也是），批次只是多了一段讀寫之間的空窗。

## 修正方式

1. 後端在 tag 模組加差異語意的端點，例如 `PATCH /tags/assignments/:resourceType/:resourceId { add?: string[], remove?: string[] }`：交易內以 `INSERT … ON CONFLICT DO NOTHING`／`DELETE` 處理，數量上限（20）在交易內檢查；權限、稽核、`afterTagsChanged` 沿用 `replaceFor` 的 resolver 流程。與角色權限的 `PATCH /roles/:id/permissions { add, remove }` 同一種形狀。
2. `gallery.tag` 改呼叫 `{ add: [tagId] }`，不再先讀；已經有這個標籤時後端不寫稽核也不推播（或寫一筆 no-op 由後端決定）。
3. 檔案管理器之後若有批次貼標籤，用同一支端點。
4. 更新 `docs/architecture/backend/18-tag.md` 的 API 表與 D7、`docs/architecture/frontend/24-gallery.md` §5；重產 openapi 與 SDK。

## 驗證方式

- 整合（`apps/api/test/tags.spec.ts`）：`PATCH … { add }` 不影響既有的其他標籤；同時對同一資源送兩個不同的 `add`，兩個都留下；超過 20 個回錯誤；沒有編輯權限 403。
- 單元（`gallery/__tests__/register.test.ts` 或新的 `batch.test.ts`）：`gallery.tag` 的 `run` 只送一個 `PATCH`、不先 GET。

（2026-10-10 backstage 各功能的優化分析發現。）
