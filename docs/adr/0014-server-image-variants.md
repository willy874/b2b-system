# ADR-0014 — 伺服器實體化圖片的三個版本、影像 API、上傳殘留的維護排程

- 狀態：**採用**（部分取代 [ADR-0013](./0013-file-manager-upload.md) D7「縮圖由瀏覽器產生」）
- 日期：2026-09-27
- 相關：[`../architecture/backend/09-file.md`](../architecture/backend/09-file.md) §5.4、§9

## 背景

ADR-0013 讓瀏覽器在上傳時產生縮圖，api 不處理影像。實際使用後的需求：

- **不同用途要不同尺寸**：列表要小圖示、LightBox 全螢幕要「夠清楚但不是 20 MB 原圖」；瀏覽器只產生了一種。
- **大圖要能漸進顯示**：全螢幕預覽在下載途中就該由模糊到清楚。瀏覽器的 `canvas.toBlob('image/jpeg')` 只能輸出 baseline JPEG，
  做不出 progressive JPEG。
- **格式依請求調整**：要能依瀏覽器支援（`Accept`）或指定取得 WebP / AVIF / PNG，瀏覽器上傳時無法預先產生所有格式。
- **縮圖依賴上傳者**：舊資料、其他管道寫入、瀏覽器解不了的格式都沒有縮圖。
- **上傳失敗的殘留**（逾時的 pending、沒有紀錄的分塊上傳、孤兒物件）一直列在「尚未處理」。

## 決定

| # | 問題 | 決定 |
| --- | --- | --- |
| D1 | 誰產生變體 | **api**，以 `core/image` 的 `ImageProcessor`（實作 sharp）；上傳完成後在背景產生，不擋 `complete` 的回應 |
| D2 | 實體化哪些版本 | 原圖（原封不動）、全螢幕預覽（長邊 2560）、圖示預覽（長邊 480），後兩者寫進 `variants/<id>/` |
| D3 | 主格式 | progressive JPEG；有透明度的圖用 WebP |
| D4 | 其他格式 | 影像 API 的 `format` 參數（`jpeg` / `webp` / `avif` / `png` / `auto`）；第一次被要求時才轉出並存起來 |
| D5 | 前端怎麼取得 | 專用的 `GET /files/:id/image/:variant`：`@Public()` ＋ 網址上的 HMAC 簽章，302 轉址到物件儲存的 presigned 網址 |
| D6 | 瀏覽器縮圖 | 保留，降為退路：變體產生前、伺服器處理不了的檔案、之後其他類型（影片封面）的擴充點 |
| D7 | 殘留清理 | api 內的維護排程（`FileMaintenanceService`），偵測四類殘留；可 dry run |

## 理由

- **sharp 而不是其他做法**：預編譯的原生套件（macOS、Linux glibc / musl 都有二進位檔），不需要在映像裡裝編譯環境——
  ADR-0013 擔心的「原生套件讓建置變複雜」在 sharp 0.33 之後已經不成立。libvips 快且省記憶體，mozjpeg 做 progressive JPEG。
- **在 api 內而不是另起服務**：目前規模下一個執行個體同時 2 張、背景執行就夠；`ImageProcessor` 是抽象類別，
  之後要搬到獨立的 worker 或外部影像服務只換實作。
- **302 轉址而不是 api 串流內容**：內容仍然不經過 api（ADR-0013 與 §5 的原則），同源代理、presigned 快取策略都沿用。
- **網址簽章而不是 cookie**：access token 只在記憶體（不進 cookie、不進 `localStorage`）；另開一個帶身分的 cookie 會多一條
  CSRF 面。簽章網址與 presigned URL 是同一個模型，大家已經熟悉。
- **格式第一次被要求才轉**：AVIF 編碼很慢，全部預先產生會讓每次上傳都付出大多數人用不到的成本。
- **維護排程在 api 內而不是腳本**：清理要用 `ObjectStorage` 與 `ImageProcessor`（DI），腳本依層級規則只能 import 純函式。

## 取捨

- **api 多了 CPU 與記憶體負載**：解碼一張 1 億像素的圖要數百 MB。以並行上限（2）、位元組上限（128 MiB）、像素上限（1 億）控制；
  超過的圖片標 `failed`，退回瀏覽器縮圖。
- **變體有延遲**：上傳完成到變體可用之間，列表用瀏覽器縮圖、LightBox 用原圖；完成後以推播更新。
- **影像 API 是公開路由**：拿到網址的人在 `exp` 之前都能讀，與 presigned URL 相同；簽章綁定檔案、版本與失效時間。
- **多執行個體會重複維護**：每一步都是冪等的，只是白工；需要時只在一個執行個體開 `FILE_MAINTENANCE_INTERVAL`。
- **孤兒物件對帳要列整個受管理前綴**：物件數量很大時變慢，屆時拉長間隔或改用儲存服務的 inventory。

## 後果

- 新依賴：`sharp`（apps/api）。
- 後端：`core/image`（`ImageProcessor`、`SharpImageProcessor`、`ImageModule`）；`ObjectStorage` 新增 `getObject`、`putObject`、
  `listObjects`、`listMultipartUploads`；`files` 新增 `variant_status`、`image_width`、`image_height`、`variant_format`、
  約束 `files_variant_ready_described`、索引 `files_variant_pending_idx`（`0008_file_image_variants.sql`，並把既有圖片排入補產生）；
  `FileImageService`、`FileMaintenanceService`；端點 `GET /files/:id/image/:variant`；`StoredFile.image`；
  錯誤碼 `FILE_IMAGE_URL_INVALID`；環境變數 `API_PUBLIC_BASE_URL`、`FILE_PENDING_TTL`、`FILE_MAINTENANCE_INTERVAL`、`FILE_MAINTENANCE_DRY_RUN`。
- apps/file-storage：支援 `ListMultipartUploads`。
- 前端：LightBox 預設顯示全螢幕預覽（`FilePreviewSource.displayUrl`），切到原始大小才載入原圖；`thumbnailUrl` 的來源由後端決定，前端不變。
