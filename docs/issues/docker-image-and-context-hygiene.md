# api 的正式映像帶著 react-email 的 CLI 依賴（esbuild、tailwindcss、babel…）

## 現況

`apps/api/package.json` 把 `react-email@^6.11.0` 列為 production 依賴，`pnpm deploy --prod`（`apps/api/Dockerfile`）會把它的依賴全部帶進映像。
它的依賴大多是預覽伺服器與 CLI 用的：`esbuild`、`@babel/parser`、`@babel/traverse`、`chokidar`、`prompts`、`commander`、`conf`，以及另一個版本的 `socket.io`…；
esbuild 在 `onlyBuiltDependencies` 裡，還會跑安裝腳本。

程式只用到元件與 `render`（`core/mail/mail-layout.tsx`、`core/mail/mail.service.ts`、`*.mail.tsx`）。

2026-10-06 查過的替代方案都不能直接換：

- v6 沒有只含元件的套件：元件與 CLI 在同一個 `react-email` 套件裡（`dist/index.cjs` 載入每一個元件，tailwind 元件又載入 `tailwindcss`）。
- 舊的 `@react-email/components`（1.0.12）與各元件的獨立套件從 2026-04 起沒有更新，少了程式依賴的 6.x 行為
  （`mail-layout.tsx` 註解提到的 `Body` 的 `lang`、`Hr` 的 `borderTop`）。
- 在映像裡刪掉 CLI 的依賴不安全：`dist/index.cjs` 會載入哪些套件要逐版確認。

同一份問題的其他部分（開發與 E2E 腳本進了 `dist`、`.dockerignore` 只排除根目錄的 `.env`）已於 2026-10-06 修正。

## 影響

- 映像變大、漏洞掃描的範圍變廣：程式不會執行這些 CLI 依賴，但每一個 CVE 都要有人判斷。
- 不是可以直接利用的漏洞。

## 修正方式

擇一：

1. 建置時把郵件範本打包：以 esbuild 把 `core/mail` 與 `*.mail.tsx` 連同用到的元件打成一個檔案，`react-email` 移到 devDependencies。
   要改 api 的建置流程（`nest build` 之外多一步），並確認 nest 的 watch 模式照常運作。
2. 等 react-email 推出只含元件的套件（或把 CLI 拆出去）再換。

## 驗證方式

- `docker run --rm --entrypoint sh b2b-system-api -c 'ls node_modules/.pnpm | grep -E "^(esbuild|tailwindcss|@babel)"'` 沒有結果
  （`socket.io` 是 api 自己的依賴，會留著）。
- 寄信相關的測試（`core/mail/__tests__/`、`modules/credential/__tests__/auth-mail.jobs.spec.ts`）照常通過，信件的 HTML 與修改前相同。
