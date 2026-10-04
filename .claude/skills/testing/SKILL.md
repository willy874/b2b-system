---
name: testing
description: 套用本 repo 的測試規範：決定要寫哪些測試、寫在哪、怎麼寫、怎麼跑、怎麼回報。在這個專案新增或修改測試（vitest 單元／元件、api 整合測試、Playwright E2E）、修 bug、完成一個功能要補測試、或執行 pnpm test / pnpm test:e2e 之前使用；也在使用者問「這要怎麼測」「測試夠不夠」「幫我補測試」「跑測試」時使用。
---

# testing

測試規則的事實來源是 **`docs/`**，這個 skill 只負責「照什麼順序讀、怎麼動手、怎麼跑、怎麼回報」。
不要憑記憶套用規則；每次使用都重新讀文件。

## 1. 載入規則

一律先讀：

1. [`docs/conventions/04-testing.md`](../../../docs/conventions/04-testing.md)：檔案位置與副檔名、寫法、各層測法、**什麼時候一定要寫**。
2. 依改動範圍再讀對應的架構文件（策略、helper、必測清單）：

| 改動範圍 | 讀 |
| --- | --- |
| `apps/backstage`、`apps/platform` 前端 | [`docs/architecture/frontend/10-testing.md`](../../../docs/architecture/frontend/10-testing.md) |
| `apps/api` | [`docs/architecture/backend/07-testing.md`](../../../docs/architecture/backend/07-testing.md) |
| `apps/e2e` | 前端 10 §4（範圍、結構、資料隔離、選擇器） |
| `data-testid`、i18n key | [`docs/conventions/06-literal-strings.md`](../../../docs/conventions/06-literal-strings.md) §3 |
| 設計系統元件（`components/`） | [`docs/architecture/frontend/07-ui-system.md`](../../../docs/architecture/frontend/07-ui-system.md) §9（story 與測試） |
| 權限相關 | [`docs/rbac/02-permission-catalog.md`](../../../docs/rbac/02-permission-catalog.md) |

被測功能本身若有架構文件（例：`backend/09-file.md`、`05-tenancy.md`），讀它的「測試」或「必測」段落。

## 2. 決定要寫哪些測試

動手前先列出清單給自己（改動大時也列給使用者看）：

1. 對照 04-testing §4「什麼時候一定要寫」，找出這次改動觸發的每一列。
2. 對照 04-testing §3「各層用什麼測」，為每一項選層級——**能用低層測的就不要往上推**：
   純函式 → 單元；service 規則 → 單元＋假 repository；DB 約束／trigger／交易 → Testcontainers 整合；
   只有跨前後端的關鍵路徑才進 Playwright。
3. 打開對應架構文件最後的「必測清單」，把這次碰到的項目勾出來。
4. 修 bug：先寫出 **會失敗** 的測試並實際跑一次確認它失敗，再修程式。

## 3. 寫測試

- 先找同資料夾或同類型的既有測試，照它的 helper 與形狀寫（例：`renderWithPermissions`、MSW handler、
  `apps/api/test/` 的 `db.ts`／`tenant.ts`／`http.ts`、`apps/e2e/helpers/`、`fixtures/accounts.ts`）。
  沒有現成 helper 才新增，並放在同一層的 helper 位置。
- 副檔名與位置照 04-testing §1 的表；放錯不會被 vitest／Playwright 收進來，等於沒寫。
- `describe` 寫受測對象、`it` 用 zh-TW 寫可觀察的行為；對應規格時在 `describe` 標出處。
- 權限 gating 的元件與頁面一律寫三案例；MSW handler 要會回 403。
- api 的 HTTP 整合測試用 `listenOnLoopback(app)`，不要把 `app.getHttpServer()` 直接交給 supertest。
- E2E 用 `data-testid`；需要新 testid 就在同一批修改加進原始碼，不拼接字串。
- E2E 在關鍵狀態（`expect` 通過之後）呼叫 `snapshot(page, '<name>')`，截圖存到不進版控的 `apps/e2e/snapshots/`（前端 10 §4.5）。
- 不提交 `it.skip` / `it.only`，不用 `sleep` 或固定等待。

寫完再用 `best-practice` skill 檢查一次一般寫程式規範（測試檔也適用 TS、命名、字面量規則）。

## 4. 執行

所有 pnpm 指令前先切 Node 24（本機 nvm 預設是 20，engine-strict 會擋）：

```bash
source ~/.nvm/nvm.sh && nvm use 24
```

先跑範圍最小的，再跑全部：

| 目的 | 指令 |
| --- | --- |
| 單一檔案 | `pnpm --filter @b2b-system/<app> exec vitest run <路徑>` |
| 單一 app | `pnpm --filter @b2b-system/<app> test` |
| 全部單元＋整合 | `pnpm test`（api 整合測試需要 Docker 在跑） |
| 型別 | `pnpm typecheck`（測試檔也要過） |
| E2E | 見下方 |

### E2E 注意事項

- `apps/e2e/global-setup.ts` 會對當前的資料庫執行 **`db:reset`**。
  跑之前 **一定** 讓 `PLATFORM_DATABASE_URL` 與 `DEFAULT_TENANT_DATABASE_URL` 指向暫用的 postgres，
  否則會清掉共用的 dev DB。不確定時先問使用者，不要直接跑。
- api 要用 `pnpm dev:e2e` 啟動（放寬速率限制、寄信走 Mailpit）；backstage、platform、mock IdP 由 Playwright 的 `webServer` 起或沿用既有的。
- 3000／5173／5175 被正在跑的 `pnpm dev` 佔用時，照前端 10 §4.3「與正在跑的 dev 環境並行」另起一組換埠的服務，不要停掉別人的程序。
- 只跑相關 spec：`pnpm --filter @b2b-system/e2e exec playwright test tests/<檔名>.spec.ts`。
- 在 git worktree 裡不要跑 `pnpm dev`／`db:up`／`mail:up`（compose 會另起容器撞埠）。
- 跑完後關鍵快照在 `apps/e2e/snapshots/<spec>/<test 標題>/`；回報時可以挑相關的截圖給使用者看。

### 已知與改動無關的失敗

- `packages/realtime` 沒有測試檔，vitest 以 1 結束。
- `packages/api-sdk` 的 codegen 測試寫死 `node_modules/.bin/tsc`。
- Testcontainers 偶發「Failed to connect to Reaper」：Docker 的問題，重跑即可。

回報時把這些與新失敗分開列；出現其他失敗，先確認在 `main` 上是否也會失敗，再判斷是不是這次造成的。

## 5. 回報

完成後回報：

1. **新增／修改的測試**：`檔案` ＋ 每個 `it` 驗證什麼，對應到 04-testing §4 的哪一列或哪個必測項目。
2. **實際跑過的指令與結果**（通過數／失敗數）；沒跑的（例：E2E 因為沒有暫用 DB）明說沒跑與原因。
3. **沒補到的缺口**：必測清單中這次相關但沒寫的項目，說明為什麼。

不要把「應該會過」當成「跑過了」。

## 6. 規則要改的時候

規則寫在 `docs/conventions/04-testing.md` 與兩份測試架構文件；要新增或修改規則就改那裡，
照 `docs/conventions/README.md` 的「新增規則」一節。本 skill 只在 **流程、指令、環境** 改變時修改
（例：新增 app、測試指令改名、已知失敗修好了要刪掉）。
