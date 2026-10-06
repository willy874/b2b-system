# 正式映像帶著開發與 E2E 的腳本和 CLI 依賴，`.dockerignore` 也只排除根目錄的 `.env`

## 現況

### 映像的內容

`apps/api/tsconfig.json` L26 的 `include` 包含 `scripts/**/*`，而 `tsconfig.build.json` L12 只排除 `test`、spec 與 `__tests__`。
因此 `nest build` 會輸出下列檔案（已在本機的 `apps/api/dist` 確認）：

- `dist/scripts/mock-oidc-idp.js`、`dist/scripts/generate-openapi.js`
- `dist/src/db/seeds/dev.js`、`dist/src/db/seeds/e2e.js`、`dist/src/db/reset.js`

`apps/api/Dockerfile` L34 把整個 `dist` 複製進 runtime，這些檔案都會進正式映像。

依賴也有類似的問題：

- `apps/api/package.json` L57 把 `react-email@^6.11.0` 列為 production 依賴。
- 它的依賴包含預覽伺服器用的 `esbuild`、`@babel/parser`、`@babel/traverse`、`chokidar`、`tailwindcss`、`socket.io`、`prompts` 等。
- `pnpm deploy --prod`（Dockerfile L22）會全部帶進映像；esbuild 在 `onlyBuiltDependencies` 裡，還會跑安裝腳本。
- 程式其實只用到元件與 `render`（`core/mail/mail-layout.tsx`、`core/mail/mail.service.ts`）。

### build context

`.dockerignore`（L1–12）排除了 `.env`、`.claude`、`docs`、`apps/e2e`、`**/.data` 等，但 `.env` 這一行只對根目錄的 `.env` 有效：

- 根目錄的 `.env.*` 與 `prompt.txt` 會進 build context。目前有 `.env.bak-20260930`，它被 gitignore，沒有進版控。
- 子目錄的 `.env`（例如 `apps/api/.env`）若存在，會被 `COPY apps/api ./apps/api`（api Dockerfile L17）帶進 build stage。ConfigModule 的 `envFilePath`（`config.module.ts` L16）會讀這個檔。
- `**/test-results`、`**/playwright-report`、`**/storybook-static` 等本機產物也在 context 裡。

已逐一比對四個 Dockerfile：它們只 COPY 指定的檔案與 `packages`、`apps/<app>` 目錄，最終映像只複製 `dist` 與 `node_modules`。**現有的映像裡沒有這些檔案。**

## 影響

- 正式容器裡可以直接執行開發與 E2E 的腳本：
  - e2e seed 的 production 檢查位置有問題，會建立已知密碼的平台管理者（見 [`e2e-seed-creates-platform-admin-before-guard.md`](./e2e-seed-creates-platform-admin-before-guard.md)）。
  - mock IdP 在 production 連不上（api 對外部 IdP 要求 https 與公網位址），但本來就不該出現在映像裡。
- 多出來的 CLI 依賴讓映像變大、漏洞掃描的範圍變廣。程式不會執行它們，但每一個 CVE 都要有人判斷。
- build context：legacy builder 或遠端 builder 會收到整個 context，包含備份的 `.env`。之後只要有人寫 `COPY . .`，備份的 `.env` 就會進映像。目前沒有實際外洩。

## 修正方式

1. `apps/api/tsconfig.build.json` 的 `exclude` 加上 `scripts`、`src/db/seeds/dev.ts`、`src/db/seeds/e2e.ts`、`src/db/reset.ts`。
   `pnpm db:seed:dev` 等指令是用 tsx 跑原始碼，不受影響。
2. 郵件範本的依賴（擇一，先確認 v6 的元件有沒有獨立的套件）：
   - 改用不帶 CLI 的套件，例如 `@react-email/render` 加只含元件的套件。
   - 把 `react-email` 移到 devDependencies，在建置時預先產生範本。
3. `.dockerignore` 補上：

   ```
   .env.*
   !.env.example
   **/.env
   **/.env.*
   prompt.txt
   .vscode
   **/test-results
   **/playwright-report
   **/storybook-static
   ```

4. `.env` 的備份不要放在 repo 目錄裡。

## 驗證方式

- `docker run --rm b2b-system-api ls dist/scripts dist/src/db/seeds`：沒有 `scripts` 目錄，seeds 裡沒有 `dev.js`、`e2e.js`。
  `ls node_modules` 也看不到 esbuild 與 tailwindcss。
- 確認 build context：寫一個暫用的 Dockerfile（`FROM alpine` ＋ `COPY . /ctx` ＋ `RUN find /ctx -maxdepth 2`），建置時看不到 `.env.*` 與 `prompt.txt`。
- 寄信相關的測試（`core/mail/__tests__/`）照常通過。
