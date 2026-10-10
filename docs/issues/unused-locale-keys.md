# 語系檔留著沒有被引用的 key，也沒有測試擋

## 現況

以 backstage 所有 `zh_TW.json`（`app/locales/` 與 `features/*/locales/`，共 2025 個 key）比對
`apps/backstage/src`、`packages/web-core/src`、`packages/ui/src` 的正式程式碼（排除測試與 story）中以字串字面量出現的 key，
沒有被引用的除了 `permission.*`（見下方）只有 6 個，兩個語系檔都有：

| key | 檔案（zh_TW 的行號；en_US 同結構） | 原因 |
| --- | --- | --- |
| `auditLog.filter.from`、`auditLog.filter.to` | `apps/backstage/src/features/audit-log/locales/zh_TW.json:9-10` | 篩選改成單一的時間範圍（`auditLog.filter.range`，同檔 `:11`）後留下 |
| `auth.logout.success` | `apps/backstage/src/features/auth/locales/zh_TW.json:15` | 登出後沒有顯示這個訊息的程式 |
| `webhook.field.url` | `apps/backstage/src/features/webhook/locales/zh_TW.json:13` | 改成多網址後欄位用 `webhook.field.urls`／`urlNumber`；投遞紀錄用的是 `webhook.delivery.field.url`（同檔 `:89`） |
| `app.subtitle` | `apps/backstage/src/app/locales/zh_TW.json:65` | 外框不再顯示副標題（`DashboardShell` 只收 `app.title`、`app.mark`） |
| `tag.filterPlaceholder` | `apps/backstage/src/app/locales/zh_TW.json:333` | 標籤篩選只用到 `tag.filter` |

`permission.*` 的 67 個 key（`permission.resource.*` 與 `permission.<resource>.<action>`）在程式裡沒有字面量，
是由後端權限目錄的 `nameI18nKey` 動態組出來的（`apps/backstage/src/mocks/resources/fixtures.ts:20` 等可看到形狀），屬於正常的動態引用。
掃描結果顯示除了 `permission.` 以外，backstage 沒有其他以樣板字串組 key 的地方。

現有的 `apps/backstage/src/app/__tests__/locales.test.ts` 只檢查「每個權限都有顯示名稱」「兩個語系的 key 集合相同」「複數形」，
沒有檢查「定義了但沒有人用」；`@b2b-system/web-core/testing` 已有 `localeKeySet`（`packages/web-core/src/testing/locales.ts:20`）可以取得 key 集合。

## 影響

- 翻譯的人會繼續維護沒有畫面的字串；改功能時看到舊 key 會以為還在用（例：`auditLog.filter.from` 與 `range` 並存，看不出哪個是現行的）。
- 沒有測試擋，刪掉功能時留下的 key 會一直累積。

嚴重度低：程式整潔，不影響行為。

## 修正方式

1. **刪除上表 6 個 key**（`zh_TW.json` 與 `en_US.json` 同步）。
2. **加「未被引用的 key」測試**：在 `packages/web-core/src/testing/locales.ts` 加 `findUnusedLocaleKeys({ bundles, sourceGlobs, dynamicPrefixes })`
   （兩個 app 都能用，web-core 自己的共用語系包也能用），掃原始碼中的字串字面量（`'…'`、`"…"`、`` `…` `` 不含 `${`），
   複數後綴（`_one`、`_other`…）視為同一個 key；`dynamicPrefixes` 是動態組 key 的白名單，backstage 目前只需要 `permission.`。
   backstage 在 `app/__tests__/locales.test.ts` 加一個案例呼叫它；apps/platform 與 web-core 的語系測試之後比照加上。
3. 白名單的每一項在測試裡註明動態組 key 的位置；新增動態前綴時要同時加白名單，等於在 review 時留下紀錄。
   `docs/architecture/frontend/08-i18n.md` 補一句這條規則。

## 驗證方式

- 刪除 6 個 key 後 `pnpm --filter @b2b-system/backstage test` 通過（含兩語系 key 集合相同的既有測試）。
- 新測試在目前的程式上通過；暫時在 `zh_TW.json` 加一個沒用到的 key、或把某個 `t('…')` 改成另一個 key，測試會失敗並列出 key 名稱。
- `pnpm --filter @b2b-system/e2e tour` 重拍後，稽核日誌、登出、Webhook 的畫面文字沒有變化。

（2026-10-10 backstage 各功能的優化分析發現。）
