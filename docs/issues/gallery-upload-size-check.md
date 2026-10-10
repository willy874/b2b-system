# 圖片庫上傳沒有在前端檢查單檔上限，「加入圖片庫」寫死 50 MiB

## 現況

- 規格 `docs/architecture/frontend/24-gallery.md` §4 的流程：「檢查（只是體驗）：檔頭簽章、型別、HEIC 另外提示……、≤ 50 MiB」。後端 `docs/architecture/backend/26-gallery.md` 第 107 行：單檔上限是租戶的 feature 參數 `gallery.maxItemSizeMb`（1～200，預設 50），超過回 `413 GALLERY_ITEM_TOO_LARGE`。
- `apps/backstage/src/features/gallery/hooks/useGalleryUpload.ts` 第 19–30 行 `checkGalleryUpload`：只檢查 HEIC、型別白名單、檔頭簽章，**沒有檢查大小**；`RejectedGalleryFile.reasonKey`（第 15 行）也沒有「太大」這個原因。
- `apps/backstage/src/features/gallery/fileAction/register.ts` 第 11–12、27–33 行：檔案管理器的「加入圖片庫」有檢查大小，但寫死 `DEFAULT_MAX_SIZE = 50 MiB`，註解自己寫「單檔上限是租戶的 feature 參數」卻沒有讀參數。
- 前端目前拿不到這個參數：`gallery` 的 api（`apps/api/src/modules/gallery/gallery-item.controller.ts`）沒有類似檔案管理 `GET` 上傳政策（`apps/backstage/src/apis/file/get-upload-policy/`，`useFileUpload.ts` 第 63–64 行用它的 `maxSize`）的端點，backstage 也沒有任何地方讀 `maxItemSizeMb`（只有 `apps/platform` 的租戶參數表單）。

## 影響

- 上傳超過上限的圖：選檔時沒有提示，檔案先寫進 IndexedDB 暫存區、送進批次佇列，到 `POST /gallery/items` 才 413，在佇列的結果彈窗裡才看到失敗。幾百 MB 的檔案白白搬進暫存區。
- 平台把某租戶的上限調成 200 MiB：「加入圖片庫」仍擋下 50～200 MiB 之間的檔案，使用者無法從檔案管理器加入其實允許的圖。調成 10 MiB：10～50 MiB 的檔案前端放行，後端在 `POST /gallery/items/from-source` 逐筆回 `tooLarge`（`26-gallery.md` §8）。

嚴重度中：與規格不一致；後端會再擋，不會存入超過上限的檔案，但調大上限時前端錯誤地拒絕合法的檔案。

## 修正方式

1. 後端提供上限：新增 `GET /gallery/upload-policy`（`gallery:create`，回 `{ maxSize, contentTypes }`），或把 `maxItemSize` 放進已有的回應（例如 `GET /gallery/items/uploads`）；選一種並寫進 `26-gallery.md` 的 API 表。
2. `useGalleryUpload` 以查詢取得上限，`checkGalleryUpload(file, { maxSize })` 加大小檢查與新的原因 `gallery.upload.tooLarge`（兩個語系檔，帶 `{{max}}`）。
3. `fileAction/register.ts` 的 `checkGalleryFile` 改成接受上限參數；`AddToGalleryDialog` 開啟時取得上限再判斷（檔案動作的 `check` 若是同步的，就在對話框內再檢查一次並列出被擋的檔案）。拿不到時退回 50 MiB。
4. 重產 openapi 與 SDK。

## 驗證方式

- 單元：`checkGalleryUpload` 超過 `maxSize` 回 `tooLarge`、等於上限放行；`checkGalleryFile` 依傳入的上限判斷（`gallery/__tests__/helpers.test.ts`）。
- 整合：新端點回的 `maxSize` 跟著租戶的 feature 參數變。
- 元件：`useGalleryUpload` 混合大小檔案時，toast 列出被擋的數量，只有通過的進佇列。

（2026-10-10 backstage 各功能的優化分析發現。）
