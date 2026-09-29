# Roadmap — Phase 0（RBAC 骨架）

> 本文件是 **架構確認後** 的實作計畫。每個里程碑有明確的驗收條件；
> 未通過驗收不進入下一個里程碑。

---

## 實作現況（2026-09-20）

M0–M5 的功能全部實作完成並跑通；以下是與驗收清單的落差，其餘項目皆已驗證。

| 狀態 | 項目 |
| --- | --- |
| ✅ | M0 骨架、M1 資料庫與 RBAC 核心、M3 認證、M4 使用者／角色、M5 稽核日誌與個人帳號 |
| ✅ | 後端 73 個測試、前端 262 個測試、E2E 17 個情境（涵蓋 §4.1 的 10 條流程） |
| ✅ | `core/permission` 100%、`core/auth` 98%、`components/` 96% 覆蓋率 |
| ✅ | M2 全部 6 個批次的元件都已實作，每個元件都有測試；`design-system.test.ts` 守住「無寫死色碼 / 不外洩 Base UI 型別 / 支援透傳」 |
| ⚠️ | **前端整體覆蓋率 41.9%**（目標 75%）：缺口集中在 `features/*/pages` 與 `apis/` |
| ⚠️ | **後端整體覆蓋率 71.9%**（目標 80%）；`common/guards` 與 `core/cache` 已達 100% 的硬門檻 |

實作過程中與文件不同的決定記錄在 [`../../CLAUDE.md`](../../CLAUDE.md) 最後一節，
相關章節也已同步更新。

---

## 總覽

| 里程碑 | 內容                           | 驗收核心                        |
| ------ | ------------------------------ | ------------------------------- |
| M0     | 專案骨架與工具鏈               | `pnpm dev` 能跑起前後端與資料庫 |
| M1     | 資料庫與 RBAC 核心（後端）     | 授權 Guard 可運作，seed 完成    |
| M2     | 設計系統（前端 `components/`） | 20 個元件可用，對比度測試全綠   |
| M3     | 認證流程（前後端）             | 登入／續期／登出端到端可用      |
| M4     | 使用者與角色管理（前後端）     | RBAC 生命週期 E2E 通過          |
| M5     | 稽核日誌、個人帳號、收尾       | 全部驗收清單通過                |

---

## M0 — 專案骨架

### 產出

```
b2b-system/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json
├── docker-compose.yml               postgres:17-alpine
├── .env.example
├── lefthook.yml / .oxlintrc.json / .oxfmtrc.jsonc
├── apps/backstage/        Vite + React 19 + TS，空白頁能跑
├── apps/api/        NestJS 11，/health 能回應
├── apps/e2e/        Playwright 設定
└── packages/
    ├── api-sdk/     （空殼，M1 後填入）
    └── utils/
```

### 驗收

- [ ] `pnpm install` 成功
- [ ] `pnpm dev` 同時起 postgres、api（:3000）、backstage（:5173）
- [ ] `curl localhost:5173/api/health` 經 Vite proxy 回到 api
- [ ] `pnpm lint` / `pnpm format:check` / `pnpm typecheck` 全部通過
- [ ] pre-commit hook 會擋下未格式化的檔案

---

## M1 — 資料庫與 RBAC 核心（後端）

### 產出

| 項目                                             | 對應文件                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `db/schema/*.ts` 全部 8 張表                     | [`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §2               |
| 手寫 migration：三個 trigger                     | 同上 §3                                                               |
| `db/seeds/` 權限目錄、系統角色、super-admin      | [`../rbac/05-seed-and-bootstrap.md`](../rbac/05-seed-and-bootstrap.md)    |
| `core/config`（Zod env 驗證）                    | [`../architecture/backend/01-architecture.md`](../architecture/backend/01-architecture.md) §6       |
| `core/database`（Drizzle provider、交易輔助）    | 同上 §5                                                               |
| `core/errors`（ErrorCode、AppException、Filter） | [`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §5 |
| `core/http`（RequestId、Transform、分頁）        | 同上 §1–2                                                             |
| `core/validation`（ZodValidationPipe）           | 同上 §3                                                               |
| `common/decorators` ＋ `common/guards`           | [`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §2–3                     |
| `PermissionService` ＋ `PermissionCacheService`  | 同上 §4–5                                                             |
| `modules/permission`（`GET /permissions`）       | [`../rbac/04-api-spec.md`](../rbac/04-api-spec.md) §4                     |
| **路由稽核**（啟動時檢查）                       | [`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §7                       |
| Testcontainers 測試環境                          | [`../architecture/backend/07-testing.md`](../architecture/backend/07-testing.md) §2                 |

### 驗收

- [ ] `pnpm db:migrate && pnpm db:seed` 成功，且 **連續執行兩次筆數不變**
- [ ] [`../rbac/05-seed-and-bootstrap.md`](../rbac/05-seed-and-bootstrap.md) §8 的
      8 項斷言全部通過
- [ ] 三個 trigger 的整合測試通過（I7 / I12 / I2）
- [ ] 故意建立一個沒有授權宣告的路由 → **程序啟動失敗**
- [ ] `PermissionCacheService` 的失效測試全部通過（含刪除角色的順序測試）
- [ ] `core/cache` 與 `common/guards` 覆蓋率 100%

---

## M2 — 設計系統（前端）

**這是前端工作量最大的一段**，因為 Base UI 不帶樣式。與 M1 可並行。

### 產出

| 批次           | 元件                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| Token          | `themes/` seed / alias / component 三層 ＋ `contrast.test.ts`                            |
| 批次 1（基礎） | `Button` `IconButton` `Link` `Typography` `Icon` `Spinner` `Skeleton` `Separator` `Chip` |
| 批次 2（表單） | `Field` `Input` `NumberField` `Select` `Combobox` `Checkbox` `Radio` `Switch` `Form`     |
| 批次 3（彈層） | `Dialog` `AlertDialog` `Popover` `Tooltip` `Menu` `Toast`                                |
| 批次 4（版面） | `Tabs` `Accordion` `Collapsible` `ScrollArea` `Breadcrumbs` `Empty`                      |
| 批次 5（資料） | `Table`（TanStack Table ＋ 虛擬捲動）`Pagination` `Avatar` `Progress`                    |
| 批次 6（延後） | `DatePicker` `DateRangePicker` `FileUpload`                                              |

> 批次 6 已完成：稽核日誌的時間篩選改用 `DateRangePicker`（不再是原生 `<input type="date">`）。

### 驗收

- [x] 每個元件有 `.test.tsx`，涵蓋鍵盤操作與 `disabled` 狀態
- [x] `contrast.test.ts` 全綠
- [x] 沒有任何 `components/**/*.css` 出現十六進位色碼（由 `__tests__/design-system.test.ts` 檢查）
- [x] 沒有任何 `components/**/*.tsx` 匯出 Base UI 型別（同上）
- [x] 所有元件支援 `ref` / `className` / `data-testid` 透傳
      （`__tests__/ref-forwarding.test.tsx` ＋ `design-system.test.ts`）

---

## M3 — 認證流程

### 後端

| 項目                                                    | 對應文件                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `modules/auth`：login / refresh / logout / profile      | [`../architecture/backend/04-auth.md`](../architecture/backend/04-auth.md)                          |
| Refresh token 輪替 ＋ 家族撤銷 ＋ 重用偵測              | 同上 §2                                                               |
| `JwtAuthGuard` ＋ `UserCacheService`                    | 同上 §6                                                               |
| Argon2 密碼雜湊、強度檢查、帳號鎖定                     | 同上 §3–4                                                             |
| 啟用 / 忘記密碼 / 重設密碼                              | 同上 §5                                                               |
| 速率限制                                                | [`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §8 |
| `@nestjs/swagger` → `openapi.json` → `packages/api-sdk` | [ADR-0007](../adr/0007-openapi-generated-api-sdk.md)                   |

### 前端

| 項目                                                | 對應文件                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `shared/context`（plugin context 實作）             | [`../architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §2         |
| `core/app`（AppContext）                            | 同上                                                                        |
| `core/auth`（SessionStore：單飛、跨分頁、終止判定） | [`../architecture/frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §5 |
| `core/client` ＋ `plugins/fetcher`（攔截器鏈）      | [`../architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §3               |
| `core/cache` ＋ `plugins/app/*`                     | 同上 §6                                                                     |
| `core/permission`（registry ＋ hooks）              | [`../architecture/frontend/06-permission.md`](../architecture/frontend/06-permission.md)                  |
| `core/router` ＋ `app/`（Layout、權限守衛）         | [`../architecture/frontend/04-routing.md`](../architecture/frontend/04-routing.md) §4                     |
| `features/auth`（登入、忘記密碼、重設、啟用）       | [`../architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md)        |
| `features/home`（空白首頁 ＋ 側邊選單）             |                                                                             |
| i18n scope 載入機制 ＋ 兩套語系檔                   | [`../architecture/frontend/08-i18n.md`](../architecture/frontend/08-i18n.md)                              |
| MSW handlers                                        | [`../architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §10              |

### 驗收

- [ ] super-admin 可以登入、看到首頁、登出
- [ ] Access token 只在記憶體（DevTools 檢查 `localStorage` 為空）
- [ ] 重新整理頁面後自動續期，不需重新登入
- [ ] **兩個分頁同時操作 30 分鐘不會被登出**（跨分頁協調）
- [ ] 手動重放舊的 refresh token → 被登出 ＋ 稽核有 `reuse_detected`
- [ ] 錯誤密碼 5 次 → 鎖定 15 分鐘
- [ ] 忘記密碼對不存在的 email 也回 200
- [ ] `core/permission` 覆蓋率 100%、`core/auth` ≥ 95%

---

## M4 — 使用者與角色管理

### 後端

- `modules/user`：列表 / 建立 / 詳情 / 更新 / 刪除 / 指派角色 / 重設密碼 / 解鎖
- `modules/role`：列表 / 建立 / 詳情 / 更新 / 刪除 / 權限增減 / 複製 / 持有者
- 全部業務規則（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8）
- 全部稽核寫入（[`../architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §2.1）

### 前端

- `features/user`：列表、建立、詳情、角色指派子頁
- `features/role`：列表、建立（含權限挑選）、詳情、權限管理子頁、複製
- `features/permission`：唯讀權限目錄
- 三層 UI gating（[`../architecture/frontend/06-permission.md`](../architecture/frontend/06-permission.md) §6）
- 反提權的前端過濾（[`../architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §9）

### 驗收（RBAC 生命週期 E2E）

- [ ] admin 建立角色 → 指派給使用者 → 該使用者登入後看到對應選單與頁面
- [ ] admin 移除該角色的權限 → 該使用者 **下一次請求即 403**（不等 TTL）
- [ ] 該使用者重新整理 → 選單項與按鈕消失
- [ ] auditor 直接輸入 `/user/create` → 看到 403 頁（不是被彈回首頁）
- [ ] admin 嘗試授予 `system:update`（自己沒有）→ `AUTHZ_ESCALATION`
- [ ] 系統角色的刪除入口不存在；直接打 API → `ROLE_SYSTEM_PROTECTED`
- [ ] 嘗試停用最後一個 super-admin → `LAST_SUPER_ADMIN`
- [ ] 使用者停用 → 其開著的分頁下一次操作被登出（`AUTH_TOKEN_STALE`）
- [ ] 每個受權限影響的 UI 元素都有「有 / 無 / 未水合」三個測試

---

## M5 — 稽核日誌、個人帳號、收尾

### 產出

- `modules/audit-log` ＋ `features/audit-log`（列表、篩選、展開差異）
- `features/account`（個人資料、變更密碼、偏好設定）
- `core/preference` 註冊表 ＋ 至少一個 `plugins/features/*` 示範
- M2 批次 6 的元件（`DatePicker` 等）
- Dockerfile ＋ nginx 設定
- `README.md`、`CLAUDE.md`

### 驗收（Phase 0 總驗收）

**架構**

- [ ] `grep -r "features/" apps/backstage/src/core/` 為空
- [ ] `grep -r "modules/" apps/api/src/core/` 為空
- [ ] 註解掉 `main.tsx` 任一 feature plugin，app 仍能啟動
- [ ] 所有 lint 相依規則通過

**安全**

- [ ] [`../architecture/backend/04-auth.md`](../architecture/backend/04-auth.md) §9 的 15 項檢查清單全部通過
- [ ] [`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §10 的反面教材都不存在於程式碼中
- [ ] [`../architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §9 的 13 項檢查清單全部通過
- [ ] 路由稽核通過；`@RequirePermissions` 使用的鍵全部存在於權限目錄

**測試**

- [ ] 前端覆蓋率 ≥ 75%，`core/permission` 100%、`core/auth` ≥ 95%
- [ ] 後端覆蓋率 ≥ 80%，`common/guards` 100%
- [ ] 10 條 E2E 全部通過（[`../architecture/frontend/10-testing.md`](../architecture/frontend/10-testing.md) §4.1）

**契約**

- [ ] `openapi.json` 與原始碼一致（重新產生無 diff）
- [ ] 每個 `ErrorCode` 有兩個語系的翻譯
- [ ] 每個權限有兩個語系的顯示名稱
- [ ] `docs/rbac/04-api-spec.md` 與 `backend/05-rbac.md` §9 的端點表
      與實際 metadata 一致（有測試比對）

**文件**

- [ ] `docs/` 與實作一致（本階段結束時逐章複查）
- [ ] `README.md` 有「從零到跑起來」的完整步驟

---

## Phase 1 之後（不在本次範圍）

依序考慮，但需要主功能的輪廓先確定：

> 各項的提案、優先度與開放問題已移到 [`../features/README.md`](../features/README.md)；
> 這裡只保留原始清單，完成狀態以 `features/` 為準。

1. **資源作用域**（[ADR-0006](../adr/0006-flat-permission-scope.md) 的延伸路徑）
2. ~~Dark Mode~~（已完成，見 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4.4）
3. MFA（`users.mfa_enabled` 已預留）
4. 批次匯入 / 匯出
5. SSO（OIDC）
6. 稽核日誌分區表
7. 多執行個體部署（權限快取換 Redis）
8. 服務帳號 / API Token
9. ~~`JsonEditor`~~（已完成：CodeMirror 6 編輯器——語法上色、行號、摺疊、復原重做、搜尋、JSON Schema 驗證；
   `JsonViewer` 外觀與它一致；見 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.12、
   [ADR-0011](../adr/0011-codemirror-json-editor.md)）。後續視需要補取代（`@codemirror/search` 已支援）、摺疊處的驗證錯誤標記
