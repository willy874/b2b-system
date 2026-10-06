# 從租戶的次要網域（客戶自訂網域）使用時，檔案上傳、縮圖與預覽會被 CSP 擋下

## 現況

presigned 網址固定用租戶的主要網域簽。`apps/api/src/core/storage/s3-object-storage.ts` 的 `presigner()`（L123–138）：

```ts
const origin = tenant
  ? `${this.appOrigin.protocol}//${await this.directory.requirePrimaryDomain(tenant.id)}`
  : this.appOrigin.origin;
```

`requirePrimaryDomain()`（`core/tenant/tenant-directory.service.ts` L142–149）回傳第一個登記的網域。

客戶自己的網域只能是次要網域：

- 主要網域是建立租戶時產生的 `{code}.<TENANT_BASE_DOMAIN>`，不能移除（`modules/tenant/platform-tenant.service.ts` L426 的 `TENANT_PRIMARY_DOMAIN`）。
- 客戶自己的網域只能加成次要網域（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D24）。

CSP 只允許同源（`deploy/nginx.security-headers.conf` L7）：`img-src 'self' data:; … connect-src 'self'`。

瀏覽器會直接對 presigned 的絕對網址發請求：

- 上傳：`apps/backstage/src/apis/file/upload-file/putToStorage.ts` L36–37，以 XHR PUT。
- 文字預覽：`apis/file/get-file-text/fetcher.ts` L27，以 `fetch`。
- 縮圖與預覽圖：影像 API `GET /files/:id/image/:variant` 回 302，轉到 presigned 網址（`modules/file/file.controller.ts` L151、L172）。

另外，prod compose 的 file-storage 沒有設 `FILE_STORAGE_ALLOWED_ORIGINS`（L218–223），不會回任何 CORS 標頭。

[`backend/09-file.md`](../architecture/backend/09-file.md) §3（L98–101）說明用主要網域是為了符合 `connect-src 'self'`，但沒有討論次要網域的情況。

重現步驟（依程式與設定判斷，**尚未在瀏覽器實跑**）：

1. 平台管理者替租戶 acme 加一個次要網域 `files.acme-corp.example`。
2. 使用者從 `https://files.acme-corp.example` 登入 backstage。登入可以成功，因為 redirect URI 的檢查接受任何屬於該租戶的網域。
3. 上傳檔案：拿到的網址是 `https://acme.<base>/storage/…`，XHR 違反 `connect-src 'self'`，被擋下。
4. 縮圖：`<img src="/api/files/…/image/thumbnail…">` 的 302 目的地在主要網域，違反 `img-src 'self'`。

## 影響

- 從自訂網域進入 backstage 的使用者：無法上傳、看不到縮圖與圖片預覽、文字預覽失敗。下載是頂層導覽，不受 CSP 影響。
- 只影響有次要網域、而且使用者從次要網域進來的租戶。不過 D24 把自訂網域列為支援的功能，要自訂網域的客戶通常就是從那個網域進來。
- 本機開發（Vite）沒有這組 CSP，E2E 也只用一個網域，所以現有的測試都測不出來。

## 修正方式

1. （建議）在 api 修：presign 時，請求的 Host 若屬於目前的租戶，就用那個網域簽；只有沒有請求可依據時（寄信、對外 API、背景工作）才用主要網域。
   - `TenantMiddleware` 已經由 Host 找到租戶，可以把比對到的網域放進 `TenantContext`，讓 `presigner()` 優先使用。
   - 影像 API 簽出來的 `/api/files/:id/image/...` 是相對網址，不受影響。
2. 不建議放寬 CSP。nginx 的 CSP 是靜態的，無法依租戶列出它的主要網域；放寬成任意網域則會失去同源的保護。
3. 更新 09-file.md §3：寫明 presigned 網址用的是「請求進來的那個租戶網域」。

## 驗證方式

- 單元測試（`core/storage/__tests__/`）：
  - 租戶脈絡帶著次要網域時，presigned 網址的 host 是次要網域。
  - 沒有請求網域時，host 是主要網域。
- 端對端驗證：替測試租戶加第二個網域（例如 `acme2.localhost:5173`），從第二個網域上傳檔案、看縮圖、預覽文字檔。
  CSP 只在 nginx 上，所以這一步要在 prod compose 驗證，或在 Vite 加上同一組 CSP 標頭。
