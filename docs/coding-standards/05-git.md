# 05 — Git 與 PR

---

## 1. Branch

- `main` 永遠可部署；不直接 push 到 `main`，一律經過 PR。
  GitHub 端還沒有開 branch protection（2026-10-06 決定暫不設定），這條靠自律；CI 在 push 到 `main` 時仍會跑一次。
- 命名：`<type>/<kebab-case 簡述>`，`type` 與 commit 的 type 相同。

```
feat/role-duplicate
fix/disabled-focus
docs/restructure
```

- 一個 branch 做一件事；做到一半發現別的問題，另開 branch。

---

## 2. Commit message

```
<type>(<scope>): <zh-TW 摘要>

<可選的內文：為什麼這樣改、取捨、關聯的文件章節>
```

### 2.1 type

| type       | 用在                                   |
| ---------- | -------------------------------------- |
| `feat`     | 新功能                                 |
| `fix`      | 修 bug                                 |
| `refactor` | 不改行為的重構                         |
| `test`     | 只動測試                               |
| `docs`     | 只動文件（`docs/`、README、CLAUDE.md） |
| `chore`    | 建置、設定、相依套件、雜項             |
| `perf`     | 效能改善                               |

### 2.2 scope

用 workspace 名稱：`api`、`backstage`、`api-sdk`、`realtime`、`e2e`、`deploy`。
跨多個 workspace 或純文件時省略 scope。

### 2.3 摘要

- zh-TW，動詞開頭或直接描述結果，結尾不加句號。
- 一行講清楚「改了什麼」；多件事用頓號，超過兩件就該拆 commit。

```
✅ feat(api): user 與 role 模組
✅ fix(backstage): 停用狀態保留焦點，Button 改包 Base UI
✅ chore: 忽略 tsc 產生的設定檔編譯產物
❌ update
❌ fix bug
❌ feat(backstage): 修改了一些東西。
```

### 2.4 粒度

- 每個 commit 都要能通過 `pnpm typecheck` 與 `pnpm lint`。由誰擋：

  | 時機 | 檢查 | 設定 |
  | --- | --- | --- |
  | commit | staged 檔案的 `oxfmt --check`、`oxlint` | `lefthook.yml` 的 pre-commit |
  | push | `pnpm typecheck`（整個 workspace） | `lefthook.yml` 的 pre-push |
  | PR、push 到 `main` | typecheck、lint、format、migration 的相容檢查（`migrations:check`）、`pnpm test`（含 api 的整合測試）、`pnpm audit --prod`、gitleaks 掃 git 歷史、兩個前端的 bundle 預算、`docker-compose.prod.yml` 整套建置啟動（`deploy/smoke-test.sh`，單體與 `--cluster`）、`deploy/check-nginx.sh`、`deploy/check-monitoring.sh`、`deploy/check-k8s.sh` | `.github/workflows/ci.yml` |

  `--no-verify` 只略過本機的 hook，CI 照樣會跑。E2E（`pnpm test:e2e`）不在 CI 裡，動到使用者流程時自己跑。
- 「三處同步」（`features/`、`modules/`、`docs/`）的變更放在 **同一個 commit 或同一個 PR**，
  不要讓 `main` 出現文件與程式碼不一致的中間狀態。
- 產生檔（`packages/api-sdk/src/generated/`、migration）與觸發它的原始碼改動放在同一個 commit。

---

## 3. Pull Request

### 3.1 標題與描述

- 標題沿用 commit message 格式；只有一個 commit 時直接用它。
- 描述包含：**為什麼要改**、**改了什麼**、**怎麼驗證**、相關的 `docs/` 章節。

### 3.2 送出前檢查清單

```
- [ ] CI 通過（typecheck、lint、format、pnpm test、依賴稽核、秘密掃描、bundle 預算、正式映像；§2.4）
- [ ] 動到使用者流程：pnpm test:e2e
- [ ] 動到 controller / DTO：已重新產生 openapi 與 SDK，且無多餘 diff
- [ ] 動到 schema：已附 migration，並人工檢視過 SQL
- [ ] 動到權限：權限目錄、seed、前端 permission.ts、兩個語系檔同步
- [ ] 動到 features/ 或 modules/：docs/ 對應章節已更新
- [ ] 與文件不同的實作決定：已寫註解並登記到 CLAUDE.md
```

### 3.3 Review

- Reviewer 特別看 [`README.md`](./README.md) 中標為 👀 的規則——那些沒有工具會擋。
- 合併方式用 squash 或保留整齊的 commit 歷史皆可，但合併後 `main` 的每個 commit 都要可建置。
