# 沒有 CI，main 也沒有保護：型別檢查、測試、依賴稽核都只靠人

## 現況

- repo 沒有任何 CI 設定（沒有 `.github/workflows`、GitLab CI 等），也沒有 Renovate 或 Dependabot。
- 2026-10-06 以 `gh api` 查 GitHub（`willy874/b2b-system`）：
  - repo 是 public。
  - Actions workflow 有 0 個。
  - `main` 回「Branch not protected」。
- `lefthook.yml`（L1–9）的 pre-commit 只對 staged 的檔案跑 `oxfmt --check` 與 `oxlint`。
  沒有 typecheck、測試、依賴稽核或秘密掃描，而且 `git commit --no-verify` 就能略過。
- [`conventions/05-git.md`](../conventions/05-git.md) 的規定與實際做法不一致：
  - §1（L7）寫「`main` 永遠可部署；不直接 push 到 `main`，一律經過 PR」。實際上多數合併在本機完成（例如 `c60e5bbe`、`cdef1a0d`、`415a70a3`），只有 PR #1 經過 GitHub。
  - §2.4（L61）寫「每個 commit 都要能通過 `pnpm typecheck` 與 `pnpm lint`（lefthook 會在 commit 前檢查 staged 檔案）」，但 lefthook 並不跑 typecheck。
  - §3.2（L75–86）的檢查清單全靠人工勾選。
- 以下檢查都只能手動跑：`pnpm typecheck`、`pnpm test`、`pnpm test:e2e`、`sh deploy/check-nginx.sh`、prod 映像的建置。

## 影響

- 問題已經發生：[`prod-compose-missing-webhook-secret-key.md`](./prod-compose-missing-webhook-secret-key.md) 從 10-02 起讓 production 部署起不來，沒有任何檢查發現。
- 依賴與基底映像的漏洞沒有人會被提醒（見 [`nginx-image-eol.md`](./nginx-image-eol.md)）。
  2026-10-06 人工跑的 `pnpm audit --prod` 是 0 個；含開發依賴則有 1 個中度（drizzle-kit 帶的舊 esbuild，只影響開發伺服器）。但這只是一次人工檢查。
- repo 是 public：不小心 commit 的金鑰，沒有任何掃描能在合併前擋下。
- main 沒有保護：任何有寫入權限的人（或代理）都能直接 push，不經過任何檢查。

## 修正方式

1. 新增 GitHub Actions workflow（`.github/workflows/ci.yml`），在 PR 與 push 到 main 時依序跑：
   1. `pnpm install --frozen-lockfile`、`pnpm build:packages`。
   2. `pnpm typecheck`、`pnpm lint`、`pnpm format:check`。
   3. `pnpm test`。後端整合測試用 Testcontainers，GitHub 的 Linux runner 上有 Docker。
   4. `pnpm audit --prod --audit-level=high`。
   5. 秘密掃描（例如 gitleaks），同時開啟 GitHub 的 secret scanning 與 push protection。
2. 另開一個 job：
   - 以假值的 env 跑 `docker compose -f docker-compose.prod.yml config` 與 `build`。
   - 起整組服務後打 api 的 `/health`，再跑 `sh deploy/check-nginx.sh`。
3. `main` 開啟 branch protection：要求經過 PR、上述檢查都通過，並禁止 force push。
4. 加 Renovate（或 Dependabot），涵蓋 npm 與 docker。
5. lefthook 加 `pre-push` 跑 `pnpm typecheck`。commit 時跑太慢，push 時剛好。
6. 修正 05-git.md §2.4「lefthook 會檢查」的說法，寫明哪些項目由 CI 擋。
   migration 對上一版相容的檢查已列在 [`multi-instance.md`](../features/multi-instance.md) 開放問題 3，這裡不重複。

## 驗證方式

- 開一個 PR，看得到必過的檢查。故意引入型別錯誤，或刪掉 compose 的必填變數，檢查要失敗、不能合併。
- `gh api repos/willy874/b2b-system/branches/main/protection` 回傳保護設定，不再是 404。
