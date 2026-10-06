# 設定與腳本的殘留：沒用到的變數、錯誤的 start 指令、進了版控的編譯產物、缺少的健康檢查與標頭

## 現況

1. `REFRESH_COOKIE_DOMAIN` 沒有任何程式讀它：
   - 它出現在 `apps/api/src/core/config/env.schema.ts` L90、`.env.example` L38、[`02-repository-structure.md`](../architecture/02-repository-structure.md) §5（L283）。
   - cookie 一律是 host-only，不設 `Domain`（[`04-sso.md`](../architecture/04-sso.md) §2）。
2. `apps/api/package.json` 的兩個啟動指令路徑錯了：
   - L8 `"start": "node dist/main.js"`、L10 `"start:external": "node dist/main.external.js"`。
   - `nest build` 的輸出其實在 `dist/src/`（tsconfig 的 `rootDir` 是 `./`），Dockerfile 用的也是 `dist/src/main.js`（L44）。
   - 這兩個指令執行時會找不到檔案。
3. 編譯產物進了版控：
   - `apps/api/scripts/generate-openapi.js` 與 `generate-openapi.js.map` 都在版控裡。
   - `openapi:generate` 實際跑的是 `.ts`（package.json L15：`node -r @swc-node/register scripts/generate-openapi.ts`）。
   - `.gitignore` 只排除 `apps/api/*.config.js`（L25–26）。
4. 三個 nginx 容器沒有健康檢查：
   - `backstage`、`platform`：Dockerfile 沒有 `HEALTHCHECK`，compose 也沒有 `healthcheck`。
   - `external-gateway`：compose L193–209 沒有 `healthcheck`。
   - api、file-storage、external-api 都有。
5. 安全標頭（`deploy/nginx.security-headers.conf` L7–11）沒有 `Permissions-Policy`，也沒有 `Cross-Origin-Opener-Policy`。
   其他標頭（CSP、HSTS、frame-ancestors 與 X-Frame-Options、nosniff、Referrer-Policy）在每個 location 都有生效。

## 影響

這些都不影響目前的行為，但會誤導讀設定的人，或讓手動操作失敗：

- 以為改 `REFRESH_COOKIE_DOMAIN` 就能改 cookie 的網域。
- 照 package.json 執行 `pnpm --filter @b2b-system/api start` 會失敗。
- 有人改了 `.ts`，看到的卻是舊的 `.js`。

另外兩點：

- 沒有健康檢查：nginx 的 worker 卡住時，compose 看不出來，也不會重啟它（容器還在跑就算健康）。
- `Permissions-Policy` 是加強項。頁面目前沒有用到相機、麥克風、定位，把它們限制掉，可以降低被注入的程式碼利用這些功能的機會。

## 修正方式

1. 刪掉 `REFRESH_COOKIE_DOMAIN`：schema、`.env.example`、02-repository-structure.md §5 一起刪。
2. 把 `start`、`start:external` 改成 `node dist/src/main.js`、`node dist/src/main.external.js`。
3. `git rm` 這兩個編譯產物，並在 `.gitignore` 加上 `apps/api/scripts/*.js` 與 `apps/api/scripts/*.js.map`。
4. 在 compose 的 `backstage`、`platform`、`external-gateway` 加上健康檢查，例如：

   ```yaml
   healthcheck:
     test: ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/']
     interval: 30s
     timeout: 3s
     retries: 3
   ```

   external-gateway 沒有靜態檔，可以加一個只允許本機連線的 `location = /_nginx_health { return 204; }` 給健康檢查用。
   這樣就不必依賴 external-api 的狀態。
5. 在 `nginx.security-headers.conf` 加上：

   ```nginx
   add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
   add_header Cross-Origin-Opener-Policy "same-origin" always;
   ```

   - `/storage/` 的 location 自己列標頭（`deploy/nginx.conf` L67–71），要一起加。
   - COOP 加之前，先確認沒有依賴 `window.opener` 的 popup 流程。目前的登入用的是頂層跳轉。

## 驗證方式

- `git grep REFRESH_COOKIE_DOMAIN` 沒有結果，`pnpm typecheck` 通過。
- `pnpm --filter @b2b-system/api build && pnpm --filter @b2b-system/api start` 能正常啟動。
- `docker compose ps` 顯示三個 nginx 容器都是 `healthy`。
- 在 `deploy/check-nginx.sh` 的標頭檢查（L63–64）加上 `permissions-policy:`，三份設定都要通過。
