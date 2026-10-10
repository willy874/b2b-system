# 圖片庫檢視器每切換一張就多一筆瀏覽紀錄，幻燈片會塞滿歷史

## 現況

- `apps/backstage/src/features/gallery/pages/Gallery/useGalleryBrowse.ts` 第 63–70 行：`updateSearch` 一律 `navigate({ to, search })`，沒有 `replace` 的選項。
- `apps/backstage/src/features/gallery/pages/Gallery/page.tsx` 第 60 行：`openItem = (itemId) => browse.updateSearch({ item: itemId })`，打開、切換、關閉檢視器都用它；第 152–153 行把它同時當成 `onNavigate` 與 `onClose`。
- `apps/backstage/src/features/gallery/pages/Gallery/components/GalleryViewer.tsx` 呼叫 `onNavigate` 的地方：第 156 行（目前這張已被刪除時 1.5 秒後自動前往下一張）、第 164 行（幻燈片每隔設定的秒數換下一張）、第 194／197 行（← / →）、第 279 行（滑動）、第 317／325 行（上一張／下一張按鈕）、第 509 行（縮圖列）、第 553 行（刪除後前往下一張）。每一次都 push 一筆歷史。

對照檔案管理器：`apps/backstage/src/features/file/pages/FileManager/useFileSearch.ts` 第 35–38 行分成 `openPreview`（push）與 `switchPreview`（`replace: true`，註解「在 LightBox 裡切換上一個／下一個不留瀏覽紀錄：返回鍵直接關掉 LightBox」）；規格 `docs/architecture/frontend/12-file-manager.md` 第 167 行也寫明切換用 `replace`。圖片庫的規格 `docs/architecture/frontend/24-gallery.md` §2 只寫「上一頁回到前一個狀態」，§9 說檢視器的按鍵「與檔案管理器的 LightBox 相同」。

## 影響

- 在檢視器看了 30 張，要按 30 次返回鍵才回到圖片庫之前的頁面；手機上的返回手勢同樣。
- 幻燈片每隔幾秒 push 一筆，放幾分鐘就是上百筆歷史。
- 「已被刪除」自動前往下一張也 push：按返回會回到一個已刪除的 `item`，再次觸發自動前往，使用者卡在原地。

嚴重度中：與同類元件（LightBox）的既定行為不一致，不影響資料。

## 修正方式

1. `updateSearch` 加第二個參數 `options?: { replace?: boolean }`，傳給 `navigate`。
2. `page.tsx` 拆成 `openItem`（從格子／列表打開，push）、`switchItem`（檢視器內切換，`replace: true`）、`closeItem`（關閉，push 或依需要 `history.back()`），`GalleryViewer` 的 `onNavigate` 接 `switchItem`。
3. 同一處檢查其他不該留紀錄的 `updateSearch` 呼叫（例如搜尋框打字，比照檔案管理器 300 ms 後 `replace`）。
4. `docs/architecture/frontend/24-gallery.md` §2 或 §9 補一句「檢視器內切換用 `replace`，返回鍵關掉檢視器」。

## 驗證方式

- 元件測試（`GalleryPage.test.tsx`）：以 memory history 打開一張、按下一張兩次，`history.length` 只多 1；按返回後檢視器關閉、回到列表。
- E2E（`apps/e2e` 的 gallery spec）：打開檢視器按 → 兩次，`page.goBack()` 後 `gallery-viewer` 不存在。

（2026-10-10 backstage 各功能的優化分析發現。）
