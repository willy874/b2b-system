# 安全與容量的後續強化

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`multi-instance.md`](./multi-instance.md)、[`observability.md`](./observability.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

2026-09-30 以「企業多租戶、1000 人同時在線」為前提，對效能、資安、邊際操作、使用者體驗做了一次全面檢查，
共 102 項，P0 全部與大部分 P1／P2 已修（merge `b8b634e`，修法寫在各正式文件）。
下面是當時刻意延後的部分：多半需要產品決策、另一個元件，或範圍大到應該單獨一個 branch。
跨實例的項目（共享快取失效、Socket.io adapter、限流共享計數、拆 worker）在 [`multi-instance.md`](./multi-instance.md)；
監控指標在 [`observability.md`](./observability.md)，這裡不重複。

## 範圍

2026-10-07 已做完的小項目（`feat/hardening-quick-wins`，修法寫在各正式文件）：外部 IdP 改用綁定位址的 `pinnedFetch`（[`04-sso.md`](../architecture/04-sso.md) §3.3）、
SecLists top 10k 常見密碼（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.2）、註冊不收密碼與審批頁的「尚未驗證」（[`rbac/06-approval.md`](../rbac/06-approval.md) §5）、
nginx 存取日誌不記 query string（[`01-system.md`](../architecture/01-system.md) §4）、登入被限流時倒數（[`04-sso.md`](../architecture/04-sso.md) §3.2）、
時區偏好的後端驗證（[`backend/12-settings.md`](../architecture/backend/12-settings.md) §5.3）、username 精確比對、檔名與資料夾名稱轉 NFC（[`backend/09-file.md`](../architecture/backend/09-file.md) §4）。

### 資安

| 項目 | 現況 | 為什麼延後 |
| --- | --- | --- |
| 每個租戶各自的 token 簽章金鑰（`kid`、非對稱簽章） | 租戶與平台的 access token 共用一把 HS256 `JWT_SECRET`（production 已拒絕範例值與低熵金鑰），租戶之間靠 `tid` 與網域比對隔離；OIDC 的 ID token 已是 RS256（`OIDC_JWKS`） | 影響 token 格式與所有驗證端，需另開設計（設計決策） |
| 使用者上傳檔案改由獨立、不帶 cookie 的網域提供 | `/storage` 與租戶同源，以 `sandbox` CSP、`nosniff`、非白名單一律 attachment 防護 | 需要部署與 DNS 決策 |
| 「帳號 × IP」計數與漸進延遲、每租戶上限、IP 白名單 | 登入以「email＋IP」與 IP 各一個桶，另有帳號鎖定 | 屬速率限制的第二版設計；共享計數見 multi-instance |

### 容量

| 項目 | 現況 | 為什麼延後 |
| --- | --- | --- |
| 檔案列表無限捲動的 `maxPages` | 推播只重抓相關資料夾，但已載入的頁會全部重抓 | 游標只能往後、列表是虛擬捲動，丟掉前面的頁要有反向游標與捲動錨定 |
| 列表的 304／ETag | 每次重抓都回完整資料 | 需要內容雜湊或列表層級的版本；單筆可用樂觀鎖的 `version` 產生 `ETag: W/"<version>"`（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D3） |
| 個人資料夾不出現在別人的資料夾樹 | 依 `rbac/07` §5.1 列出但鎖住，樹的大小隨人數成長 | 產品決策 |
| outbox 清掃只進入有寫入的租戶；relay 移出交易 | 每 10 分鐘進入每個租戶 | 目前頻率下影響已小。2026-10-07 評估後 **不做**：清掃要補救的正是「提交與搬移之間程序當掉」，這時程序記憶體裡的「有寫入的租戶」也一起消失；多實例時執行清掃的 worker 也看不到 api 程序記下的名單，要可靠就得另寫平台 DB，代價比每 10 分鐘進一次每個租戶大。relay 移出交易會失去 `SKIP LOCKED` 的互斥，尖峰時幾十個提交各自重送同一批到平台 DB |
| 登入端點的 argon2 並行上限 | `UV_THREADPOOL_SIZE=16` | 要搭配限流的第二版一起決定排隊行為 |
| 每個租戶覆寫連線池大小、PgBouncer | 連線預算公式在 `backend/02-database.md` §6.2 | 公式寫明了何時需要 |
| 稽核冷表的保留期限（按月分區、DROP PARTITION） | 冷表無限保留 | 要先訂法規上的保留年限；與 multi-instance 的「稽核日誌分區」一起做 |
| 影像處理的記憶體實測 | 原圖串流到暫存檔、逐列解碼、兩個版本依序 render | 需要壓測環境 |

### 邊際操作與體驗

| 項目 | 現況 | 為什麼延後 |
| --- | --- | --- |
| 列表「選取全部符合的 N 筆」 | 批次只能選本頁 | 需要後端依條件批次處理的 API |
| session 結束時保留表單草稿 | 未儲存提醒降低損失 | 需要草稿儲存機制 |

## 開放問題

1. super-admin 的名稱與說明能不能改？[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §5 寫不可改，
   但 `RoleService.update` 沒有擋（2026-09-30 確認：只有 `updatePermissions` 以 `ROLE_SUPER_ADMIN_IMMUTABLE` 擋權限變更；
   其他系統角色的顯示名稱可改是既定決定）。
   **結論**：依規格不可改。`RoleService.update` 對 super-admin 回 `403 ROLE_SUPER_ADMIN_IMMUTABLE`（前端本來就不提供編輯）。**已實作**（`b399ef2`）；規格見 `rbac/01-domain-model.md` §5。
2. `identityProvider:*` 要不要只給 super-admin？目前 seed 給 `admin` 全部四個、`auditor` 給 `read`；
   自動連結已限定連線登記的網域，並排除持有 `member` 以外系統角色的帳號。
   **結論**（2026-10-07）：維持現狀。admin 本來就能管理使用者，設定外部 IdP 不會多拿到權限；自動連結的限制已擋住接管系統角色帳號的路徑。
3. 上傳檔案的獨立網域要用每個租戶一個子網域，還是全平台共用一個？
   **結論**：全平台共用一個（例 `files.example.com`）。檔案網域上沒有 cookie 與登入狀態，內容只能以 presigned 網址讀取，每租戶子網域的隔離效果相同，卻要萬用 DNS 與萬用憑證；
   設定支援 `{tenantCode}` 佔位符，部署端日後要改成每租戶子網域不必改程式。上傳維持同源，只有下載與預覽搬到檔案網域。見「設計決策」§2 D1、D2。

## 設計決策

> 2026-10-07 起草，**待 review**。只涵蓋上方「範圍」中需要另外設計的十個項目；不需要設計的小項目已直接做完（見「範圍」開頭）。
> 每項以「本文件 設計決策 §N Dn」引用（例：`hardening-followups.md 設計決策 §3 D6`）；歸檔時各項搬到「歸檔去向」列出的規格，`D` 編號在新規格接續編號並註明出處。
> 標示「**待使用者決定**」的地方附上建議；其餘的決定若 review 沒有異議就照做。

### 0. 總表

| # | 項目 | 建議 | 規模 | 順序 | 依賴與備註 |
| --- | --- | --- | --- | --- | --- |
| 1 | token 簽章金鑰 | **縮小範圍做**：金鑰環＋`kid`、限定演算法、平台與租戶分開金鑰、縮圖網址的金鑰獨立；**每租戶非對稱金鑰延後**（寫明觸發條件） | S | 1 | 無；做完 external-api 不再持有 `JWT_SECRET` |
| 3a | 速率限制：argon2 並行上限、每租戶的登入上限 | 做 | S | 2 | 先把 `createLimiter` 抽成共用；計數走 §3 D1 的介面 |
| 4 | 個人資料夾不出現在別人的樹 | 做（**待使用者決定**是否推翻 `rbac/07` D12 的「沒有例外」） | S | 3 | 無 |
| 2 | 上傳檔案改由獨立網域提供 | 做：下載走全平台共用的檔案網域，上傳維持同源 | M | 4 | 需要 DNS 與憑證（一個名稱）；開放問題 3 的結論 |
| 5 | 稽核冷表保留期限 | 做：冷表按月分區；刪除以 `DROP` 分區執行，保留年限 **待使用者決定** | M | 5 | 回答 `multi-instance.md` 開放問題 2（不併成單一分區表） |
| 3b | 速率限制：「帳號 × IP」漸進延遲、已知來源、IP 白名單 | 做 | M | 6 | §3 D1 的計數介面；共享計數仍由 `multi-instance.md` 換實作 |
| 7 | 列表「選取全部符合的 N 筆」 | 做：前端依條件收集 id 後交給既有的批次佇列，上限 10 000；**不加後端批次端點** | M | 7 | 無；超過上限或要關分頁也能跑的需求併入 `import-export.md` |
| 9 | 列表的 304／ETag | **不做列表層級的版本**；改為明確的 `Cache-Control`（`no-store` 或 `no-cache` **待使用者決定**） | S | 8 | 現況更正：Express 預設的弱 ETag 其實已在運作 |
| 6 | session 結束時保留表單草稿 | 做（低優先）：只在非自願結束時、加密存在本機 | M | 9 | **待使用者決定**是否放寬 `frontend/09` §4.2 的本機儲存規則 |
| 8 | 檔案列表無限捲動的 `maxPages` | **延後**（設計已備妥，寫明觸發條件） | M | — | 後端要加反向游標 |
| 10 | 每租戶連線池、PgBouncer、影像處理記憶體實測 | **現在不做**（寫明觸發條件與屆時的前置作業） | — | — | 觸發條件多半要 `observability.md` 的指標才看得到 |

順序的理由：1、3a、4 小而獨立，先清掉；2 要等部署端準備網域；5 的 migration 要對每個租戶 DB 執行，與其他 migration 錯開；3b 要先有 3a 抽出的介面；7、9、6 是體驗改善，不影響安全底線。

---

### 1. 每個租戶各自的 token 簽章金鑰

#### 1.1 背景

現況（程式碼）：

- 租戶與平台的 access token 都由 `@nestjs/jwt` 以 HS256、同一把 `JWT_SECRET` 簽發（`modules/auth/auth.module.ts`，`auth.service.ts` 的 `signAccessToken`、`platform-auth.service.ts`）。
  claims 是 `{ sub, ver, jti, tid | realm: 'platform', sid?, iat, exp }`，沒有 `kid`、`iss`、`aud`；TTL `JWT_ACCESS_TTL` 預設 300 秒。
- 驗證只有一處：`common/auth/access-token.verifier.ts` 的 `verifyClaims`。HTTP（`JwtAuthGuard`）、限流的主體判斷（`RateLimitGuard.principalOf`）、
  WebSocket 握手與 `session.renew`（`realtime.gateway.ts`）、登出都經過它。`verifyAsync` **沒有傳 `algorithms`**。
  租戶的隔離靠 `payload.tid === currentTenant().id`（沒有租戶的網域只收 `realm: 'platform'`，[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D10）。
- refresh token、啟用與重設 token 都是不透明亂數、只存 sha256，**與 `JWT_SECRET` 無關**；API token（`b2bt_…`）也不是 JWT，external-api 從不驗 JWT。
- OIDC 的 ID token 是 RS256（`OIDC_JWKS`），但只在 api 程序內兌換（BFF），沒有第三方驗證。全平台一個 issuer、一組 JWKS 是既定決定（05-tenancy D6，§10.5 已否決每租戶一個 issuer）。
- `JWT_SECRET` 另有一個用途：檔案縮圖網址的 HMAC 金鑰由它推導（`modules/file/file-image-url.ts`，簽 `fileId\nvariant\nexpiresAt`，不含租戶）。
  external-api 為了簽縮圖網址而持有 `JWT_SECRET`（[`06-external-api.md`](../architecture/06-external-api.md) §6 的秘密範圍表，「還沒做」已列出）。
  **這是目前最實際的風險**：對外入口被攻破時，拿到的 `JWT_SECRET` 能偽造任何租戶、任何人、包括平台管理者的 access token。

所以「每個租戶一把非對稱金鑰」要回答的是：它防的是什麼？

- 防「租戶 A 的 token 拿到租戶 B 用」：已由 `tid` ＝ 網域租戶擋住，與金鑰無關。
- 防「金鑰外洩後偽造」：簽發與驗證都在 api 程序；api 被攻破時，不論金鑰放環境變數或以 `core/crypto` 加密存在平台 DB（解密金鑰 `TENANT_SECRET_KEY` 也在同一個程序），都拿得到 **所有** 租戶的金鑰。每租戶分開金鑰在這個威脅下沒有隔離效果。
- 非對稱的好處是「驗證端不能簽」，前提是存在只驗不簽的元件；目前沒有。

#### 1.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **這一版不做每租戶非對稱金鑰**；改做 D2～D5，並以 D6 的觸發條件決定何時做 | 見 §1.1：現在的架構下沒有可隔離的對象；真正的缺口是 external-api 持有 `JWT_SECRET`（D5） |
| D2 | **金鑰環＋`kid`**：新環境變數 `JWT_SIGNING_KEYS`，格式 `<kid>:<base64 金鑰>[,<kid>:<base64 金鑰>…]`；**第一把簽發**，全部都能驗證。簽發時 header 帶 `kid`；驗證依 `kid` 選金鑰，不認得的 `kid` 回 `401 AUTH_TOKEN_INVALID`。`kid` 限 `[A-Za-z0-9_-]{1,32}`、不可重複；每把金鑰 ≥ 32 位元組，production 沿用 `isWeakSecret` 的檢查 | 輪替不再造成「所有人同時 401 → 同時 refresh」的尖峰（1000 人在線時是 1000 次 refresh 擠在 5 分鐘內，且 WebSocket 的 `session.renew` 會失敗）；外洩時可以立刻拿掉舊金鑰。`kid` 也是 D6 之後換成非對稱金鑰時，新舊格式並存的前提 |
| D3 | **驗證固定演算法**：`verifyAsync(token, { algorithms: ['HS256'], … })`，並要求 header 的 `alg` 與金鑰的類型一致；`kid` 缺漏只在遷移期間（§1.5 第 1 步）以 legacy 金鑰驗證 | 不依賴函式庫對 `alg: none`／演算法混淆的預設行為；D6 引入非對稱金鑰後同一個 verifier 會同時看到兩種演算法，必須以金鑰決定演算法，不能以 token 自稱的 `alg` 決定 |
| D4 | **平台 realm 用另一組金鑰環** `PLATFORM_JWT_SIGNING_KEYS`。租戶網域只用租戶的金鑰環驗證、沒有租戶的網域只用平台的金鑰環驗證；`realm`／`tid` 的比對保留 | 縱深防禦：即使 claims 的比對出錯（例如將來新增一種 realm），租戶的金鑰也簽不出能在平台網域通過的 token。成本是一個環境變數 |
| D5 | **縮圖網址的金鑰獨立**：新環境變數 `FILE_URL_SIGNING_KEY`（32 位元組），簽章內容改為 `v2\n<tenantId>\n<fileId>\n<variant>\n<expiresAt>`；external-api 改持有它，**不再持有 JWT 金鑰**（06-external-api §6 秘密範圍表的 `JWT_SECRET` 列改成「—」） | 對外入口被攻破時不能偽造 access token；簽章帶租戶，一個租戶的網址換到另一個租戶的網域時直接驗不過（現在是靠查不到檔案而 404） |
| D6 | **每租戶非對稱金鑰的觸發條件**（任一成立就做，設計見 §1.3 方案 C）：① 出現 api 程序以外、只需要驗證 token 的元件（獨立的 realtime 服務、邊緣閘道、租戶專屬部署）；② 客戶合約要求租戶專屬金鑰、自備金鑰（BYOK），或刪除租戶時以銷毀金鑰證明 token 失效；③ 平台 realm 拆成獨立程序 | 三者都會讓「簽的人」與「驗的人」分開，非對稱與分租戶才有實質效果 |

不做：`iss`／`aud` claims（`tid`／`realm` 已表達受眾，加了只是重複）、access token 的撤銷清單（`token_version` 與 5 分鐘 TTL 已足夠，[`backend/04-auth.md`](../architecture/backend/04-auth.md) §10）。

#### 1.3 評估過的方案

| 方案 | 內容 | 結論 |
| --- | --- | --- |
| A. 維持現狀 | 單一 HS256 金鑰 | 不採用：輪替會造成 refresh 尖峰；external-api 持有能偽造所有 token 的金鑰 |
| B. 金鑰環＋分離用途（本決定） | D2～D5 | 採用：成本 S，補上真正的缺口，也替 C 鋪好 `kid` |
| C. 每租戶 ES256 金鑰 | 平台 DB 新表 `tenant_signing_keys(tenant_id, kid, alg, public_jwk, private_jwk_encrypted, status: active｜retiring｜retired, created_at, retire_after)`；私鑰以 `SecretBox` 新用途 `TOKEN_SIGNING_KEY` 加密（`core/crypto`，密文要先加上金鑰版本前綴，現在的格式 `iv.tag.ciphertext` 沒有版本）；`kid` = `<tenantCode>.<yyyymmdd>`；`TenantDirectory` 快取每個租戶的公鑰；每 90 天由背景工作輪替、舊鑰保留 `JWT_ACCESS_TTL` ＋ 緩衝後退役；租戶網域提供 `/api/.well-known/jwks.json`；平台 realm 一組自己的金鑰 | 延後到 D6 的條件成立。代價：簽發要查快取、佈建多一步、刪除租戶要銷毀金鑰、external-api 若要驗證就得能讀公鑰 |
| D. 每租戶 HMAC 金鑰（由主金鑰以 HKDF 推導） | `HKDF(master, tenantId)` | 不採用：主金鑰外洩等於全部外洩，只是看起來分開 |
| E. 每租戶一個 OIDC issuer | 每租戶一個 `oidc-provider` 實例與 JWKS | 不採用：05-tenancy §10.5 已否決，理由不變 |

#### 1.4 影響的模組與檔案

- `apps/api/src/core/config/env.schema.ts`：`JWT_SIGNING_KEYS`、`PLATFORM_JWT_SIGNING_KEYS`、`FILE_URL_SIGNING_KEY` 的解析與 production 檢查；`JWT_SECRET` 在遷移完成後移除。
  dev 的 `SecretBox` 推導種子（`fromConfig` 的 `fallbackSeed`）改用 `JWT_SIGNING_KEYS` 的第一把，或改為獨立的 dev 種子。
- `apps/api/src/modules/auth/auth.module.ts`、`auth.service.ts`、`platform-auth.service.ts`：簽發時帶 `keyid`、依 realm 選金鑰環。
- `apps/api/src/common/auth/access-token.verifier.ts`：解析 header 的 `kid` → 選金鑰環（依網域）→ 選金鑰 → `algorithms` 固定。
- `apps/api/src/modules/file/file-image-url.ts`、`file-image.service.ts`：v2 簽章與 v1 的過渡驗證。
- `apps/api/src/modules/api-token/external/external-api.module.ts`：更正 `JwtModule.register` 旁的註解（`verifyClaims` 並非「一定拒絕」，在沒有租戶的脈絡下會接受平台 token；改為不提供任何金鑰，讓它真的一定拒絕）。
- `docker-compose.prod.yml`、`deploy/prod.env.example`、`apps/api/src/core/config/__tests__/prod-compose-env.spec.ts`：external-api 的秘密範圍。
- 文件：`backend/04-auth.md` §1（表格補上 `realm`、`kid`）、§6（範例程式碼已過時，順便更正）、§10.2（claims 已不只 `{sub, ver, jti}`）；`06-external-api.md` §6；`backend/09-file.md` §5.4。

#### 1.5 遷移步驟

1. **第一次部署**：api 同時接受「有 `kid`」（金鑰環）與「沒有 `kid`」（以 `JWT_SECRET` 當 legacy 金鑰）的 token，簽發一律用金鑰環。縮圖網址同時接受 v1 與 v2，簽發用 v2。
   `JWT_SIGNING_KEYS` 的第一把可以直接沿用 `JWT_SECRET` 的值（`kid` 隨意命名），讓這次部署連一次 401 都沒有。
2. 等 `JWT_ACCESS_TTL`（5 分鐘）＋ `FILE_URL_TTL`（最多 1 小時）之後，舊 token 與舊網址都已過期。
3. **第二次部署**：移除 legacy 路徑與 `JWT_SECRET`；external-api 拿掉 JWT 金鑰。之後的輪替＝在 `JWT_SIGNING_KEYS` 前面加一把新的、部署，過一個 TTL 再刪掉舊的、部署。

#### 1.6 測試方式

- verifier 單元測試：未知 `kid` 拒絕；`alg: none`、`alg: RS256` 帶 HMAC 金鑰拒絕；租戶金鑰簽的平台 token 在平台網域被拒；金鑰環第二把仍可驗證；遷移期間無 `kid` 的 token 可驗、第二次部署後被拒。
- 縮圖網址：v2 換租戶網域驗證失敗；v1 在過渡期可用。
- `prod-compose-env.spec.ts`：external-api 拿不到 `JWT_SIGNING_KEYS`、`PLATFORM_JWT_SIGNING_KEYS`。
- 整合測試：輪替（換第一把金鑰）期間，既有 WebSocket 的 `session.renew` 與 HTTP 請求都不出現 401。

#### 1.7 待使用者決定

- **是否接受 D1（每租戶非對稱金鑰延後）**。建議接受：理由見 §1.1；D6 的條件成立時再做，屆時 `kid` 已就位，不必再改一次 token 格式。

---

### 2. 使用者上傳的檔案改由獨立、不帶 cookie 的網域提供

#### 2.1 背景

現況（[`backend/09-file.md`](../architecture/backend/09-file.md) §3、§5.4、§7.2，[`03-file-storage.md`](../architecture/03-file-storage.md) §3.1、§6）：

- api 不串流檔案內容。瀏覽器拿到 presigned 網址：`url`（白名單類型 inline）、`downloadUrl`（一律 attachment）；網址是 `{tenantOrigin}/storage/<bucket>/<key>`，
  由請求進來的租戶網域決定（`FILE_STORAGE_PUBLIC_ENDPOINT` 預設 `{tenantOrigin}/storage`）。縮圖走 `GET /api/files/:id/image/:variant`（HMAC 網址）→ 302 到 presigned 網址。
- 上傳也是瀏覽器以 presigned 網址直接 `PUT` 到同源的 `/storage`（multipart 要讀 `ETag`）。
- 防護：nginx `location /storage/` 與 file-storage 都送 `Content-Security-Policy: default-src 'none'; …; sandbox`、`nosniff`；
  非白名單類型一律 attachment 並改成 `application/octet-stream`（HTML、PDF 也是）。
- backstage 的 CSP 是靜態的：`img-src 'self' data:`、`connect-src 'self'`（`deploy/nginx.security-headers.conf`），文字預覽以 `fetch(file.url)` 讀內容。
- refresh cookie 是 host-only、`Path=/api/auth`，`/storage` 的請求本來就不帶它。

風險不在 cookie 被送出，而在 **同源**：只要有一個使用者上傳的檔案能在租戶網域上執行腳本，那段腳本就能以同源身分呼叫 `/api/auth/refresh`（瀏覽器會帶 cookie，自訂 header 也加得上）
拿到 access token，等於接管帳號。現在擋住它的是 `sandbox` CSP 與類型政策——兩道都在設定裡，換成 S3／MinIO 或 nginx 設定被改掉時就消失（`deploy/nginx.conf` 的註解已點出這一點）。
獨立網域把這個風險從「設定正確才安全」變成「結構上就不可能」。

#### 2.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **下載與預覽改由獨立的檔案網域提供，上傳維持同源**。新環境變數 `FILE_STORAGE_DOWNLOAD_ENDPOINT`（例 `https://files.example.com/storage`），只用於 `presignDownload`；`presignUpload`／multipart 仍用 `FILE_STORAGE_PUBLIC_ENDPOINT`（`{tenantOrigin}/storage`）。`S3ObjectStorage` 已經是「每個 public endpoint 一個 presigner」，多一個 endpoint 即可 | 只有「被瀏覽器渲染」的回應有風險，上傳的回應不會被渲染。上傳維持同源就不必處理跨來源的 multipart（preflight、每個租戶網域都要列進 CORS 白名單、`connect-src` 放寬到上傳） |
| D2 | **全平台共用一個檔案網域**（開放問題 3）；`FILE_STORAGE_DOWNLOAD_ENDPOINT` 支援 `{tenantCode}` 佔位符，部署端日後要改成每租戶子網域（`https://{tenantCode}.files.example.com/storage`）不必改程式 | 檔案網域上沒有 cookie、沒有登入狀態，內容只能以 presigned 網址讀取；在那裡執行的腳本（假設防護全失效）也讀不到別的租戶的檔案。每租戶子網域要萬用 DNS 與萬用憑證（DNS-01 驗證），CSP 也要放成 `https://*.files.example.com`，效果與單一網域相同。見下方開放問題 3 的結論 |
| D3 | **backstage 的 CSP 加上檔案網域**：`img-src`、`media-src`、`connect-src` 加 `FILE_STORAGE_DOWNLOAD_ENDPOINT` 的 origin。nginx 的 CSP 由部署時的環境變數產生（同 `deploy/nginx-real-ip.sh` 的做法），值是單一 origin，維持靜態 | 單一網域讓 CSP 仍是一個固定值；09-file §3「不放寬 CSP」的理由（列不出每個租戶的網域）不再成立，因為檔案網域只有一個 |
| D4 | **檔案網域的 nginx `server` 只開 `GET`／`HEAD` 的 `/storage/`**（其他方法 405、其他路徑 404），不轉給 api、不設任何 cookie；沿用現在 `/storage/` 的所有安全標頭，另加 `Cross-Origin-Resource-Policy: cross-origin`；CORS 回 `Access-Control-Allow-Origin: *`（不帶 credentials） | 文字預覽的 `fetch` 是跨來源讀取，需要 CORS；presigned 網址本身就是憑證，`*` 不會讓沒有網址的人讀到內容，也免去維護每個租戶網域的白名單 |
| D5 | **防護全部保留**：`sandbox` CSP、`nosniff`、類型白名單與 attachment 政策不因網域分離而放寬 | 縱深防禦。分離之後才有條件討論「PDF 改 inline」之類的放寬，那是另一個決定 |
| D6 | **縮圖的影像 API 留在租戶網域**（`/api/files/:id/image/…` 要租戶脈絡），302 的目的地改為檔案網域 | `<img>` 跟隨跨來源的轉址沒有限制 |
| D7 | **沒設定時行為不變**：`FILE_STORAGE_DOWNLOAD_ENDPOINT` 預設等於 `FILE_STORAGE_PUBLIC_ENDPOINT`（本機與 E2E 照舊同源）；production 沒設時啟動記一次警告，不拒絕啟動 | 小型部署可以不準備第二個網域；警告讓維運知道少了一層保護 |

#### 2.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| A. 維持同源，只靠 CSP 與類型政策 | 不採用：防護完全依賴設定；換成 S3 時 bucket 不會送 `sandbox` CSP |
| B. 上傳與下載都搬到檔案網域 | 不採用：multipart 跨來源要 preflight、`ETag` 暴露、每個租戶網域列進 CORS（file-storage 的白名單是整個服務共用的環境變數，列不出動態的租戶網域），收益為零 |
| C. 每租戶一個檔案子網域 | 不採用為預設（D2）：多出萬用 DNS／憑證的維運成本，隔離效果與單一網域相同；保留佔位符讓部署端可以選 |
| D. api 串流檔案內容、加上 `Content-Disposition` | 不採用：大檔佔用 api 的頻寬與 event loop，與 09-file 直傳的設計相反 |

#### 2.4 影響的模組與檔案

- `apps/api/src/core/config/env.schema.ts`：`FILE_STORAGE_DOWNLOAD_ENDPOINT`（含 `{tenantOrigin}`、`{tenantCode}` 佔位符）。
- `apps/api/src/core/storage/s3-object-storage.ts`：`presignDownload` 改用下載的 presigner。
- `deploy/nginx.conf`（或新增 `deploy/nginx.files.conf`）、`deploy/nginx.security-headers.conf` 的 CSP 產生方式、`docker-compose.prod.yml`、`deploy/prod.env.example`、`deploy/check-nginx.sh`、`deploy/smoke-test.sh`。
- `apps/file-storage`：不必改（CORS 由檔案網域的 nginx 處理；或讓 `FILE_STORAGE_ALLOWED_ORIGINS` 接受 `*`）。
- 前端不必改（網址是後端給的）；確認文字預覽的 `fetch` 不帶 `credentials: 'include'`。
- 文件：`backend/09-file.md` §3、§7.2，`03-file-storage.md` §3.1、§6，`architecture/01-system.md` §4.2（部署拓撲），`05-tenancy.md` §7（部署）。

#### 2.5 遷移步驟

1. 部署端準備 DNS 與憑證（一個名稱，例 `files.example.com`），nginx 加上檔案網域的 `server`，指向同一個 file-storage。
2. 設定 `FILE_STORAGE_DOWNLOAD_ENDPOINT` 並部署 api 與 nginx（CSP 同時更新）。已發出的同源網址在 `FILE_URL_TTL` 內仍有效（同源的 `/storage/` 照舊可用，上傳也還要用它）。
3. 沒有資料遷移：物件、bucket、key 都不變，SigV4 簽的是新的 host，file-storage 不在乎 host 是哪個。

#### 2.6 測試方式

- 單元：`presignDownload` 的網址 host 是檔案網域、`presignUpload` 仍是租戶網域；`{tenantCode}` 佔位符的替換。
- `deploy/check-nginx.sh`：檔案網域的 `PUT`／`POST` 回 405、非 `/storage/` 路徑 404、回應沒有 `Set-Cookie`、帶 `sandbox` CSP 與 `Access-Control-Allow-Origin: *`；backstage 的 CSP 含檔案網域。
- E2E：以 `localhost` 與 `127.0.0.1` 當兩個 origin（或 `files.localhost`），驗證圖片、影片、文字預覽、下載與上傳都正常。

---

### 3. 速率限制第二版

#### 3.1 背景

現況（`common/rate-limit.ts`、`common/guards/rate-limit.guard.ts`，[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §8，[`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.3）：

- 固定 60 秒視窗，計數放在 `@nestjs/throttler` 的記憶體 storage（每個程序各自計數）。
- `auth`：IP 桶 `AUTH_IP_RATE_LIMIT`（300/分）＋「租戶或平台 × email × IP」桶 `AUTH_RATE_LIMIT`（10/分）；已登入的帳號操作改以主體計數。`authMail`、`refresh` 另有規則。
- 帳號鎖定：租戶使用者讀系統設定 `auth.loginMaxAttempts`（5）／`auth.loginLockoutSeconds`（900），平台管理者讀環境變數；`users.failed_login_count`、`locked_until`。
  鎖定只看帳號、不看來源：**任何人知道 email 就能讓對方被鎖 15 分鐘**（試 5 次錯的密碼）。
- 密碼驗證只有兩個實作（`AuthService.verifyCredentials`、`PlatformAdminService.verifyCredentials`），正式環境的入口是 OIDC 互動的 `POST /oidc-interaction/:uid/login`。
  argon2 用 `@node-rs/argon2`（`memoryCost 19456 KiB`、`timeCost 2`），未知帳號也做一次假驗證；平台端（`platform-account.service.ts`、`platform-admin.service.ts`）用的是 **預設參數**，沒有讀 `ARGON2_*` 環境變數。
- `UV_THREADPOOL_SIZE=16`（`apps/api/Dockerfile`），argon2、sharp、DNS、檔案 I/O、zlib 共用；argon2 沒有並行上限，一陣登入尖峰可以佔滿整個 threadpool，連帶拖慢影像處理與 webhook 的 DNS 查詢。
- 程序內現成的佇列：`modules/file/file-image.service.ts` 私有的 `createLimiter`（FIFO、空出的名額直接交給下一個等待者）。

共享計數（多實例時上限不變成 N 倍）是 [`multi-instance.md`](./multi-instance.md) 的範圍；這裡定的是 **計數什麼、怎麼反應**，兩者以 D1 的介面銜接。

#### 3.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **計數介面 `RateLimitStore`**（`core/rate-limit/`）：`hit(key, windowMs) → { count, resetMs }`、`peek(key)`、`reset(key)`。第二版先以記憶體實作（取代直接注入 throttler 的 storage）；`multi-instance.md` 的 Postgres 實作只換這個介面的實作，規則不動 | 第二版不必等多實例；多實例也不必重寫規則。鎖定（`locked_until`）與 D3 的已知來源本來就在 DB，多實例下天生共享 |
| D2 | **「帳號 × IP」漸進延遲**：以「租戶或平台 × email × IP 前綴（IPv4 /32、IPv6 /64）」計算 **15 分鐘內的密碼錯誤次數**（只算錯誤，不算請求數）。第 3 次錯誤之後，下一次嘗試要等 `2^(n−3)` 秒（1、2、4…，上限 60 秒）；以 `429 RATE_LIMITED` ＋ `Retry-After` 回應，**伺服器不 sleep**。成功登入清除。未知的 email 一樣計數 | 每分鐘 10 次的桶擋不住「每分鐘 9 次、持續一整天」；延遲讓單一來源的猜測成本指數成長，正常使用者打錯兩次不受影響。不 sleep：睡著的請求仍佔著連線與 argon2 名額之外的資源，攻擊者可以拿它耗盡連線 |
| D3 | **已知來源不觸發鎖定**：登入成功時記錄「使用者 × IP 前綴」（租戶 DB 新表 `user_login_sources(user_id, ip_prefix, last_success_at)`，保留 30 天，每天清理；平台 DB 對平台管理者一張同樣的表）。`failed_login_count` 只在 **未知來源** 的錯誤時增加；已知來源的錯誤只吃 D2 的延遲 | 解決「知道 email 就能鎖住別人」：受害者從平常的辦公室 IP 仍能登入；分散式的撞庫（來自大量陌生 IP）仍會觸發鎖定。代價：同一個 NAT 後面的內部人員不會觸發鎖定，但仍受 D2 的延遲與每分鐘 10 次的桶限制 |
| D4 | **每租戶的登入上限**：`auth` 政策加一個「租戶」桶，預設 `AUTH_TENANT_RATE_LIMIT` = 1200/分（平台登入另一個桶，同值）；平台可對個別租戶以 feature 參數 `rateLimit.authPerMinute` 覆寫（[`05-tenancy.md`](../architecture/05-tenancy.md) §13）。超過時只有那個租戶回 429 | 一個租戶被攻擊時，攻擊流量（與它消耗的 argon2）不該拖垮其他租戶的登入。1200/分足以應付 1000 人的公司在上班時間集中登入。一般 API 不加租戶桶：每人 600/分與租戶連線池已是自然上限 |
| D5 | **IP 白名單是「放寬」不是「豁免」**：feature 參數 `rateLimit.trustedCidrs`（逗號分隔的 CIDR，由平台管理者設定）——來自這些網段、登入該租戶的請求，`auth` 的 IP 桶上限 ×10；帳號桶、D2 的延遲、D4 的租戶桶不變。另有全平台的環境變數 `RATE_LIMIT_EXEMPT_CIDRS`，只給監控探針、內部服務，豁免 `anonymous` 與 IP 桶（不豁免任何帳號層級的限制） | 企業 NAT 後面整間公司共用一個 IP，早上登入尖峰會撞到每 IP 300/分；放寬 IP 桶就夠了，帳號層級的保護沒有理由因來源可信而拿掉。由平台設定：放寬會消耗共用的容量 |
| D6 | **argon2 的並行上限**：所有 hash／verify（含假驗證、變更密碼、重設、註冊、平台端）經過同一個程序內的 `PasswordHasher`：並行 `ARGON2_MAX_CONCURRENCY`（預設 4）、等待佇列 `ARGON2_MAX_QUEUE`（預設 32）、等待逾時 `ARGON2_QUEUE_TIMEOUT_MS`（預設 3000）。佇列滿或逾時回新錯誤碼 `503 AUTH_BUSY` ＋ `Retry-After: 2`。限制器從 `file-image.service.ts` 抽成共用的 `core/concurrency/limiter.ts`（加上佇列上限與逾時）；平台端順便改讀 `ARGON2_*` 參數 | 4 個並行 ≈ 76 MiB 記憶體、留 12 條 threadpool 給 sharp／DNS／I/O；單次驗證約 25–60 ms，4 個並行仍有每秒數十次的吞吐，遠高於 D4 的上限。快速失敗（503）比讓請求在 threadpool 裡無限排隊好：前端可以提示稍後再試，攻擊流量也不會讓正常的 API 變慢。上限是 **每程序**（CPU 是每台機器的資源），多實例時不共享 |
| D7 | **前端**：登入表單遇到 `429`／`503 AUTH_BUSY` 時，以 `retryAfterSeconds`（或 `Retry-After`）倒數並停用送出鈕（即「範圍」裡的「登入被 429 時倒數」）；D2 的延遲不額外提示「帳號可能被鎖」，訊息與一般限流相同 | 不洩漏「這個帳號存在而且正在被延遲」 |
| D8 | **與 multi-instance 的銜接**：D2、D4、D5 的計數與既有的桶都經過 D1；實例數 N > 1 而還沒換成共享實作時，記憶體計數的上限實際變成 N 倍（與現在相同的已知限制，寫在 `03-api-conventions.md` §8）。寫入量：D2 只在密碼錯誤時寫、D3 每次成功登入一次 upsert，都遠小於 `multi-instance.md` 開放問題 1 擔心的「每個請求一次寫入」 | 讓 multi-instance 評估 Postgres 計數時有明確的寫入量依據 |

#### 3.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| 伺服器端 sleep 做延遲 | 不採用：見 D2 |
| CAPTCHA 取代延遲 | 不採用：要引入第三方服務；通用後台的使用者多半在公司網路，延遲已足夠。之後若要做，掛在 D2 的「延遲超過 N 秒」之後 |
| 裝置 cookie（記住瀏覽器）取代 IP 前綴當已知來源 | 這一版不採用：登入在 apps/platform 的 OIDC 互動裡，cookie 要跨網域傳遞與輪替；IP 前綴已能解決主要問題。之後與 [`mfa.md`](./mfa.md) 的「記住這台裝置」一起做 |
| argon2 每租戶各自一個佇列（公平排程） | 不採用：D4 的租戶桶已限制單一租戶能送進來的量；多一層排程的複雜度不值得 |
| 降低 argon2 參數換吞吐 | 不採用：參數是密碼強度的決定（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.1），不該被容量問題綁架 |
| 租戶管理者自己設定 IP 白名單 | 見 §3.5 |

#### 3.4 影響的模組與檔案

- 新增 `apps/api/src/core/rate-limit/`（`RateLimitStore` 介面與記憶體實作）、`apps/api/src/core/concurrency/limiter.ts`。
- `apps/api/src/common/rate-limit.ts`、`common/guards/rate-limit.guard.ts`：改用 `RateLimitStore`；租戶桶、白名單。
- `apps/api/src/modules/credential/password.ts`：`PasswordHasher`；`auth.service.ts`、`platform-account.service.ts`、`platform-admin.service.ts` 改用它。
- `apps/api/src/modules/auth/auth.service.ts`、`platform-admin.service.ts`：漸進延遲（錯誤計數）、已知來源、鎖定條件。
- 新表：租戶 DB `user_login_sources`（下一個租戶 migration）、平台 DB `platform_admin_login_sources`（平台 migration 0016）；清理掛在既有的每日維護。
- `apps/api/src/core/tenant/tenant-feature-params.ts`：`rateLimit.authPerMinute`、`rateLimit.trustedCidrs`；apps/platform 的租戶參數畫面。
- `apps/api/src/core/config/env.schema.ts`：`AUTH_TENANT_RATE_LIMIT`、`RATE_LIMIT_EXEMPT_CIDRS`、`ARGON2_MAX_CONCURRENCY`、`ARGON2_MAX_QUEUE`、`ARGON2_QUEUE_TIMEOUT_MS`。
- `packages/error-codes`（`AUTH_BUSY`）＋ `packages/web-core` 的 `ERROR_MESSAGE_KEY` 與兩個 app 的語系檔；apps/platform 登入頁的倒數。
- 文件：`backend/03-api-conventions.md` §8、`backend/04-auth.md` §3.3、§4.1、`backend/02-database.md`（新表）、`05-tenancy.md` §13（參數）。

#### 3.5 遷移步驟

1. **3a**：抽出 limiter、`PasswordHasher`、`AUTH_BUSY`、租戶桶（D4、D6）；只動程式，無資料遷移。
2. **3b**：`RateLimitStore`（D1）→ 漸進延遲（D2）→ 已知來源與鎖定條件（D3，新表；上線當下沒有任何已知來源，等於維持現在的鎖定行為，使用者登入一次之後才生效）→ 白名單（D5）。
3. 多實例上線時，`multi-instance.md` 以 Postgres 實作 `RateLimitStore`。

#### 3.6 測試方式

- 單元：漸進延遲的 `Retry-After` 數列；成功後清除；已知來源的錯誤不增加 `failed_login_count`；白名單只放寬 IP 桶；`PasswordHasher` 的佇列上限、逾時、FIFO。
- 整合：同一 email 從兩個 IP 輪流猜（各自延遲、帳號鎖定只算陌生 IP）；租戶 A 超過租戶桶時租戶 B 不受影響；並行 50 次登入時其中多出的回 `503 AUTH_BUSY`，同時影像處理的請求不受阻塞。
- E2E：登入頁倒數與送出鈕停用（`pnpm dev:e2e` 已放寬速率，該測試要另設較低的上限）。
- 壓測（與 `observability.md` 一起）：在正式規格的機器上量 argon2 單次耗時，校正 `ARGON2_MAX_CONCURRENCY`。

#### 3.7 待使用者決定

- **D3 改變鎖定的語意**（已知來源不觸發鎖定）。建議接受：現在的鎖定可以被任何人拿來阻斷別人登入，而 04-auth §3.3 本來就說「鎖定只是輔助，真正的防線是限流」。
- **IP 白名單由誰設定**：平台管理者（feature 參數，D5）或租戶管理者（系統設定）。建議平台管理者：放寬的是共用容量；租戶管理者也不一定知道公司的出口 IP。

---

### 4. 個人資料夾不出現在別人的資料夾樹

#### 4.1 背景

[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §5.1 與 §13.2 D11、D12：能進檔案管理器的人看得到 **所有** 資料夾的名稱與結構，沒有 `read` 的鎖住，可以申請存取；
「別人的個人資料夾也一樣，規則沒有例外」。實作（`file-folder.service.ts` 的 `list`、`file-folder.rules.ts` 的 `toFolderDto`）回傳整棵樹的平面清單，
前端（`FileFolderTree.tsx`，沒有虛擬化、遞迴 render）自己組樹；樹、麵包屑、主區塊、移動對話框共用同一個查詢。

代價：

- 1000 人的租戶，每個人的樹都有 1000 個鎖住的個人資料夾，回應與 render 隨人數成長。
- 每個人都看得到全公司每個人的顯示名稱（個人資料夾以顯示名稱命名），而且能對任何人的個人資料夾送出存取申請——對擁有者而言是騷擾的管道。
- 「知道資料夾存在、可以申請」（D11 的理由）對個人資料夾不成立：個人資料夾是誰的一看名稱就知道，要東西直接問本人即可。

#### 4.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **`GET /file-folders` 不回傳別人的個人資料夾（`kind = 'personal'`、`owner_id ≠ 自己`）**，除非：有全域 `file:read`（照舊看全部，rbac/07 D1）；或對該資料夾 **或它的任一子孫** 有 `read`。後者若本身沒有 `read`，仍以鎖住的節點出現（才走得到裡面被分享的資料夾） | 只有被分享的部分可見，樹的大小與「自己 ＋ 被分享」成正比。D11 的「鎖住也列出」對其他資料夾不變：只有個人資料夾是例外 |
| D2 | **隱藏的資料夾在其他端點一律回 `404 FILE_FOLDER_NOT_FOUND`**（`GET /files?folderId=`、存取申請、授權、說明、改名、移動、刪除、還原、對外 API），與檔案「看不到就 404」（rbac/07 §5.2）一致 | 不以 403 洩漏「這個 id 存在而且是某人的個人資料夾」 |
| D3 | **不能對看不到的個人資料夾申請存取**；分享由擁有者主動做。已送出、尚未處理的申請照常可核准或駁回 | 隨 D1 自然成立；擁有者不再收到陌生人的申請 |
| D4 | 判斷集中在 `FileAccessContext`（新增 `isHidden(folderId)`，由 `folderCapabilities` 由下往上算一次「子孫是否有可讀節點」，O(n)），`list` 與所有以 id 進入的端點共用；資料夾樹快取（`FileFolderTree`）不變 | 規則只有一份；O(n) 與現在每個請求本來就做的能力計算同一個量級（rbac/07 D9） |
| D5 | **前端**：有全域 `file:read` 的管理者仍看到全部，「私人資料夾」節點 **預設收合**、展開才 render 子節點 | 管理者的樹仍是 O(人數)，但不必一次 render；不必為了這個做樹的虛擬化 |

不做：「分享給我的」虛擬節點（之後依需求另提）；`ensurePersonalFolders` 的批次化（範圍裡另一個項目，與本項無關）。

#### 4.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| A. 維持列出但鎖住（rbac/07 D12） | 不採用：見 §4.1 的三個代價 |
| B. 隱藏所有沒有 `read` 的資料夾（不只個人資料夾） | 不採用：推翻 D11 的使用者需求（2026-09-29：知道資料夾存在、能自助申請） |
| C. 前端過濾、後端照舊回傳 | 不採用：名稱仍在回應裡，隱私沒有改善 |
| D. 樹改成依父節點分頁載入（lazy tree） | 不採用：樹、麵包屑、移動對話框都依賴完整的平面清單（`folderTree.ts`），改動大；D1 之後一般成員的清單已經很小 |

#### 4.4 影響的模組與檔案

- `apps/api/src/modules/file/file-access.context.ts`（`isHidden`）、`file-folder.service.ts`（`list` 過濾）、`file-folder-grant.service.ts`、`file-access-request.service.ts`、`file-access-explain.service.ts`、`file.service.ts`（`folderId` 檢查）、`file-folder-move.service.ts`、`file-folder-restore.service.ts`、`external/file.external.service.ts`。
- `apps/backstage/src/features/file/components/FileFolderTree.tsx`（「私人資料夾」預設收合）。
- 文件：`rbac/07-resource-grants.md` §5.1、§12，§13.2 新增一條決定並在 D12 註明「別人的個人資料夾改為不列出，見 D-新」。

#### 4.5 遷移步驟

只有程式；沒有資料遷移。上線後一般成員的樹立刻變小；已經展開或書籤到別人個人資料夾的網址會看到「找不到資料夾」。

#### 4.6 測試方式

- 單元（`FileAccessContext`）：別人的個人資料夾隱藏；子孫被分享時以鎖住節點出現；全域 `file:read` 看全部；super-admin 看全部。
- 整合：隱藏的資料夾對 `GET /files?folderId=`、`POST /file-folders/:id/access-requests`、`PATCH`、`DELETE` 都回 404；被分享子孫後可從樹走到。
- 頁面：一般成員的樹沒有別人的個人資料夾；管理者的「私人資料夾」預設收合。

#### 4.7 待使用者決定

- **是否推翻 rbac/07 D12 的「別人的個人資料夾與其他資料夾一致（列出、鎖住），規則沒有例外」**。建議推翻：D11 的理由（知道存在才能申請）不適用於以人名命名的個人資料夾，而樹的大小與名單外洩是實際的代價。

---

### 5. 稽核冷表的保留期限

#### 5.1 背景

現況（[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §8、[`backend/02-database.md`](../architecture/backend/02-database.md) §7）：

- 熱表 `audit_logs` 保留租戶參數 `auditLog.hotRetentionDays`（預設 90，05-tenancy §13.3 D7）天，每天 `auditLog.archive` 以 `archive_audit_logs(cutoff, 5000)`（`SECURITY DEFINER`）搬到冷表 `audit_logs_archive`。
- 冷表 **沒有分區、永久保留**；`audit_logs_archive_no_delete` trigger 禁止刪除，熱表的刪除 trigger 要求冷表已有副本。
- 06-audit-log §8 寫了「保留期 ≥ 365 天」「超過約 1000 萬列時按月分區」「分區化之後用 `DROP TABLE <partition>`，在那之前由維運 role 處理」，但沒有實作，也沒有訂保留年限。
- 查詢：`list()` 只有在範圍早於冷表最新一筆時才 `UNION ALL` 冷表（範圍最多 90 天）；`findById` 先熱後冷。
- `multi-instance.md` 範圍裡有「稽核日誌改成按月分區（取代熱表／冷表）」，開放問題 2 問要不要現在做。
- 估算（06-audit-log §8）：100 位活躍管理員 → 約 180 萬筆／年；1000 萬列約是 5 年的量。

#### 5.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **熱表／冷表維持；只把冷表改成按月 RANGE 分區**（`occurred_at`）。回答 `multi-instance.md` 開放問題 2：**不把兩張表併成一張分區表** | 熱表的大小固定在「保留天數」的量，永遠不會「撐不住」；併成一張分區表要重寫搬移、查詢、刪除保護與熱表參數，收益只有少一個背景工作。冷表才是會無限成長、需要 `DROP` 的那一張 |
| D2 | **現在就分區，不等 1000 萬列** | 改造的成本與資料量成正比：現在多數租戶的冷表是空的或很小，migration 幾乎瞬間完成；等到 1000 萬列時要搬一次全部資料 |
| D3 | **保留期限是平台管理的租戶參數 `auditLog.retentionDays`**（feature 參數，[`05-tenancy.md`](../architecture/05-tenancy.md) §13）：空值＝永久保留；有值時最小 365、最大 3650，且必須大於 `auditLog.hotRetentionDays`。**租戶管理者不能改** | 稽核要能對抗租戶內部的竄改：能縮短保留期的人等於能刪稽核。預設值見 §5.6 |
| D4 | **刪除只以 `DROP` 整個月份分區執行**：新的 `SECURITY DEFINER` 函式 `drop_expired_audit_archive_partitions(cutoff date)` 只刪「上界 ≤ cutoff」的分區，函式內再以 `cutoff ≤ now() − 365 days` 自我限制（傳入更晚的日期一律拒絕），回傳刪掉的分區名稱與列數。刪除後在熱表寫一筆稽核 `auditLog.purge`（`metadata`：分區、列數、保留天數） | 瞬間完成、不產生 bloat，也不必拿掉 `no_delete` trigger；硬下限讓應用程式的 role 即使被濫用也刪不到一年內的資料。實際保留會比設定多最多一個月（以月為單位刪） |
| D5 | **分區的建立**：`archive_audit_logs` 在搬移前呼叫 `ensure_audit_archive_partitions(from, to)` 建出這批資料涵蓋的月份；每天的工作另外預建下個月。**不建 default 分區** | 沒有 default 分區，之後建立新分區不必掃描 default；找不到分區時插入失敗、整批 rollback，工作重試，不會默默丟資料 |
| D6 | **刪除保護沿用**：`audit_logs_archive_no_delete` 改建在分區表上（Postgres 13 起 row trigger 會套到每個分區）；應用程式的 role 不是擁有者，無法 `DROP`／`DETACH`，只能透過 D4 的函式 | 不可竄改的保證與現在相同 |
| D7 | **主鍵改為 `(id, occurred_at)`**（分區表的唯一鍵必須包含分區鍵）；四個索引照舊建在分區表上（時間、操作者、資源、`action` pattern）。`findById` 會探查每個分區的主鍵索引，一年 12 個，可接受 | 列表一律帶時間範圍（最多 90 天），只會碰到 3–4 個分區 |
| D8 | **`auditLog.archive` 的流程**：搬移 → 預建分區 → 租戶設了 `retentionDays` 時呼叫 D4。平台的 `platform_audit_logs` 量小，這次不處理 | 沿用既有的排程、重試與背景工作頁 |

#### 5.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| A. 單一分區表取代熱表／冷表（multi-instance 的原構想） | 不採用：見 D1 |
| B. 冷表不分區，以批次 `DELETE` 清理 | 不採用：要拿掉或繞過 `no_delete` trigger；大量 `DELETE` 鎖表、產生 bloat，06-audit-log §8 已說明 |
| C. 等冷表到 1000 萬列再分區（06-audit-log §8 原寫法） | 不採用：見 D2 |
| D. 刪除前自動匯出到物件儲存 | 不採用為這一版的必要條件：匯出是 [`import-export.md`](./import-export.md) 的範圍；需要時在 D4 之前插入一步「匯出該月份」 |
| E. 保留期限由租戶管理者以系統設定調整 | 不採用：見 D3 |

#### 5.4 影響的模組與檔案

- 新的租戶 migration（目前最新是 `0037`）：分區表、函式 `ensure_audit_archive_partitions`、`drop_expired_audit_archive_partitions`、改寫 `archive_audit_logs`、trigger 與 lz4 壓縮設定重建。
- `apps/api/src/db/schema/audit-logs.ts`（主鍵）、`modules/audit-log/audit-log-archive.job.ts`、`audit-log.archive.ts`、`db/archive-audit-logs.ts`（手動補跑也做預建與刪除）。
- `apps/api/src/core/tenant/tenant-feature-params.ts`（`auditLog.retentionDays`）；apps/platform 的租戶參數畫面。
- 文件：`backend/06-audit-log.md` §8（並修正「冷表沒有 `action` 索引」的過時描述，migration `0005` 已加上）、`backend/02-database.md` §2.8、§7、`backend/10-jobs.md`、`05-tenancy.md` §13；`multi-instance.md` 的範圍列與開放問題 2 依 D1 更新。

#### 5.5 遷移步驟

每個租戶 DB 執行一次（`pnpm db:migrate` 會走過所有租戶）：

1. `ALTER TABLE audit_logs_archive RENAME TO audit_logs_archive_legacy`。
2. 建分區表 `audit_logs_archive (…) PARTITION BY RANGE (occurred_at)`，依 legacy 的 `min／max(occurred_at)` 建出每個月的分區與下個月的分區，建索引、trigger、壓縮設定。
3. `INSERT INTO audit_logs_archive SELECT * FROM audit_logs_archive_legacy`；比對列數；`DROP TABLE audit_logs_archive_legacy`（`no_delete` 是 row trigger，不擋 `DROP`）。
4. 重建 `archive_audit_logs` 與熱表刪除 guard 引用的物件（名稱不變）。

migration 期間 `auditLog.archive` 不能同時執行（同一個交易內完成即可，冷表在這段時間被鎖住，只影響查詢 90 天以前的稽核）。大型租戶（百萬列以上）要在維護時段執行，並先在備份上量時間。

#### 5.6 測試方式

- 整合（Testcontainers）：搬移跨月份的資料會自動建分區；沒有分區時整批 rollback；`drop_expired_audit_archive_partitions` 拒絕一年內的 cutoff、只刪完整月份、寫 `auditLog.purge`；應用程式的 role 不能 `DROP`／`DELETE` 分區；`list` 與 `findById` 跨熱表、冷表多個分區的結果與改造前相同。
- migration 測試：以含舊冷表資料的 DB 跑 migration，列數與內容一致。

#### 5.7 待使用者決定

- **預設保留期限**。建議預設「永久」（空值），由平台管理者依租戶的合約或法規逐一設定；需要全平台預設時，常見的選擇是 7 年（2557 天，會計與稅務類記錄常見的保存年限）。最小值固定 365 天（06-audit-log §8 既有的「保留期 ≥ 365 天」）。

---

### 6. session 結束時保留表單草稿

#### 6.1 背景

現況（`packages/web-core/src/shell/SessionWatcher.tsx`、`auth/sessionEnd.ts`，[`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2、§6.2）：

- session 結束時 `clearUserData()`（權限、`queryClient.clear()`）後以 `ignoreBlocker` 導向登入頁並帶 `redirect`；**表單內容全部遺失**，沒有就地重新登入的流程。
- 未儲存提醒 `useUnsavedChangesGuard`（`useBlocker` ＋ `enableBeforeUnload`）只防使用者自己離開，不防 session 結束。（09 §6.2 寫「不攔截關閉分頁」已過時，程式有開 `beforeunload`，歸檔時一併更正。）
- 本機儲存的規則：localStorage 不放「任何個人識別資訊」「任何伺服器資料的複本」（09 §4.2）；IndexedDB 目前只放上傳佇列的檔案，session 結束時清除。
- 結束的原因（`SessionStore.endSession(reason)`）：自己登出、單一登出（`AUTH_REFRESH_REVOKED`）、`main_session_ended`、變更密碼（`password_changed`）、
  `AUTH_REFRESH_EXPIRED`／`AUTH_REFRESH_INVALID`、`AUTH_REFRESH_REUSED`、`AUTH_TOKEN_STALE`、`AUTH_ACCOUNT_DISABLED`、推播的 `session.revoked`。沒有閒置登出。

會遺失草稿的實際情境：refresh token 7 天沒用而過期、家族滿 30 天（`REFRESH_FAMILY_MAX_AGE`）、在另一個分頁變更了密碼。

#### 6.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **只在非自願、且仍是同一個人會回來的結束原因保留草稿**：`AUTH_REFRESH_EXPIRED`、`AUTH_REFRESH_INVALID`、`password_changed`。其他原因（登出、單一登出、`main_session_ended`、`AUTH_REFRESH_REUSED`、`AUTH_TOKEN_STALE`、`AUTH_ACCOUNT_DISABLED`、`session.revoked`）**不保留，並清除該使用者既有的草稿** | 登出與單一登出是使用者的意思（可能是共用電腦）；重用偵測、被停用、被撤銷代表帳號可能落在別人手上，不該留下任何東西 |
| D2 | **表單逐一選擇加入**：web-core 新增 `useFormDraft({ key, form, exclude })`（`key` 是 route id ＋ 實體 id，例 `user.detail:<id>`）；`SessionWatcher` 在 `clearUserData()` 之前同步呼叫已登記表單的序列化。只序列化 dirty 的表單；`type="password"` 的欄位與 `exclude` 一律不存 | 不是每個表單都值得保存（短表單重填即可）；只在結束當下存，不做定時自動儲存（範圍小，也不會在平常留下資料） |
| D3 | **存放**：IndexedDB 的 `draftStore`（`packages/web-shared/src/storage/`，與 `blobStore` 同一層），以 WebCrypto AES-GCM 加密，金鑰是每個瀏覽器產生一次、**不可匯出**（`extractable: false`）的 `CryptoKey`，存在同一個 IndexedDB。紀錄以「origin × 使用者 id × key」索引，附實體的 `version` 與時間；**24 小時過期**，最多 20 筆、每筆 256 KiB | 加密讓磁碟上的資料不是明文（備份、鑑識、其他程式讀檔都看不到內容）；不可匯出的金鑰讓 XSS 帶不走金鑰（但能在頁面內解密——XSS 本來就讀得到畫面上的表單，沒有更差） |
| D4 | **還原**：重新登入回到 `redirect` 後，表單掛載時若有 **同一個使用者** 的草稿，顯示提示列「有上次未儲存的內容（時間）」與「還原」「捨棄」，不自動套用。還原後送出仍帶草稿時的 `version`，伺服器已更新時照常 `409`（[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11） | 使用者決定要不要；樂觀鎖已經處理「草稿過時」 |
| D5 | **登入成為不同使用者時清除所有草稿**；自己登出時清除自己的草稿 | 共用電腦的下一個人看不到上一個人的草稿 |

#### 6.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| A. 就地重新登入（彈出視窗跑 OIDC，回來後換新 session、頁面不離開） | 不採用為這一版：登入在 apps/platform 的 OIDC 互動，外部 IdP 也可能介入，彈出視窗會被阻擋、要處理跨視窗的 PKCE 與「回來的是不是同一個人」；而且 D1 的情境多半是分頁放了幾天，使用者回來時本來就要重新登入 |
| B. 伺服器端草稿（新表與 API） | 不採用：每種表單都要後端配合、把未送出的個人資料存到伺服器，對這個問題太重 |
| C. sessionStorage 明文 | 不採用：重新登入是頂層導向（`redirect`），sessionStorage 雖然留得住，但明文且違反 09 §4.2 的精神 |
| D. 什麼都不做（只有未儲存提醒） | 可接受的替代：情境不常見。若 §6.5 決定不放寬規則，就採用這個 |

#### 6.4 影響的模組與檔案

- `packages/web-core/src/shell/SessionWatcher.tsx`、`auth/sessionEnd.ts`（哪些原因保留）、新增 `packages/web-core/src/form/useFormDraft.ts`（或放在 `router/` 旁）。
- `packages/web-shared/src/storage/draftStore.ts`。
- 各 app 選擇加入的表單（先挑長表單：公告、Webhook、角色權限、使用者詳情）。
- 語系：`packages/web-core` 共用字串（提示列）。
- 文件：`frontend/09-state-and-storage.md` §4.2（新增一列「加密的表單草稿，24 小時」）、§6.2（更正 `beforeunload`、新增草稿）。

#### 6.5 遷移步驟與測試

- 沒有資料遷移。表單逐一加入，不加入的表單行為不變。
- 單元：`draftStore` 加解密、過期、筆數上限、換使用者清除；`useFormDraft` 排除密碼欄位。
- 元件／E2E：編輯中模擬 `AUTH_REFRESH_EXPIRED` → 重新登入 → 回到同頁看到提示 → 還原內容；`AUTH_ACCOUNT_DISABLED` 時不保留；以另一個帳號登入看不到草稿。

#### 6.6 待使用者決定

- **是否放寬 09 §4.2「本機不放個人識別資訊、不放伺服器資料的複本」**，允許「加密、24 小時、只在非自願結束時」的表單草稿。建議放寬並照 D1～D5 做，優先度低；若不放寬，這一項改為「不做」（方案 D），並從範圍移除。

---

### 7. 列表「選取全部符合的 N 筆」

#### 7.1 背景

現況（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.2、§13，[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §10）：

- `useTableSelection` 存的是 **明確的 id**（跨頁保留），不存篩選條件。有批次的列表：使用者（啟用、停用、解鎖、刪除，帶 `version`）、角色（刪除）、審批（核准、駁回）；檔案管理器有自己的選取列。
- 批次一律由前端的 **批次佇列** 逐筆呼叫單筆 API（07 §13 D1；後端的批次端點已刪除，§13.5）：SharedWorker 排程、分頁執行、跨分頁接手、429 時暫停，**沒有筆數上限**（D11），session 結束時清空（D12），至少要有一個分頁開著。
- 背景工作（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）沒有進度 API，也沒有使用者觸發、等待結果的工作。
- 列表的分頁：offset，`limit` 最多 200、`offset` 最多 10 000（`core/http/pagination.ts`）。

「依條件批次處理」若在後端做，要重做 07 §13 刻意拿掉的東西（批次端點、逐筆的權限與樂觀鎖、部分失敗的回報），還要新增進度 API。

#### 7.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **不加後端的依條件批次端點**：「選取全部符合的 N 筆」在前端把條件 **展開成 id 清單**，交給既有的批次佇列 | 權限、樂觀鎖、單筆的稽核與錯誤處理全部沿用單筆 API；佇列已有進度、暫停、跨分頁接手、失敗清單 |
| D2 | **展開方式**：確認執行時，以同一個列表 API、同樣的篩選與排序、`limit = 200` 逐頁取回 `{ id, version }`（可中止，顯示「正在收集 N 筆」）；**上限 10 000 筆**（`BATCH_SELECT_ALL_MAX`，與 `MAX_OFFSET` 相同）。總數超過上限時不提供「選取全部」，提示縮小篩選範圍 | 不必新增端點；10 000 筆在 offset 上限之內，逐筆以每筆約 50–100 ms 計約 10–15 分鐘，佇列可以承擔。收集在執行前完成，執行過程的刪除、狀態變更不會影響已收集的清單 |
| D3 | **語意是快照**：清單在確認當下決定。收集之後才被別人改過的項目，單筆 API 回 `409`／`404`，照佇列既有的方式列進失敗清單 | 與單頁選取的語意一致；不需要「執行時重新套用條件」這種難以解釋的行為 |
| D4 | **UI**（Gmail 的模式）：勾選「本頁全選」後，選取列多一行「已選取本頁 20 筆。**選取全部符合的 1 234 筆**」；進入「全部符合」模式後，取消勾選任一列即回到明確選取模式（這一版不支援「全部符合，但排除這幾筆」）；篩選改變時清除（沿用 07 §6.2） | 排除清單要跟著快照一起傳遞，複雜度高、需求少 |
| D5 | **`RichTable`／`useTableSelection` 的擴充**：選取狀態加上 `{ mode: 'allMatching', total, collect: (signal) => AsyncIterable<{ id, version }> }`，由列表頁提供 `collect`（呼叫自己 feature 的 `apis/`）；批次動作的 `run` 收到的是 id 來源而不是陣列 | web-core 不知道各列表的 API（「packages 不 import app」）；列表頁本來就擁有篩選條件 |
| D6 | **先做三個列表**：使用者、角色、審批。檔案管理器（資料夾內全選）之後另行評估 | 這三個已有 `RichTable` 的批次；檔案管理器的選取列是另一套 |

觸發「改成後端批次」的條件：單次超過 10 000 筆的需求、或需要關掉分頁仍繼續執行。屆時併入 [`import-export.md`](./import-export.md) 的背景工作框架（同樣需要進度回報與結果檔），不在這裡另做一套。

#### 7.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| A. 後端 `POST /<resource>/bulk-<action>`（帶篩選條件）＋ 背景工作 ＋ 進度 API | 不採用為這一版：見 §7.1；與 07 §13 D1 的決定衝突，且進度 API 是另一個功能 |
| B. 新增輕量端點 `GET /<resource>/ids?<篩選>`，一次回傳全部 id | 不採用為第一版：每個資源都要加端點與 OpenAPI；D2 的逐頁收集在 10 000 筆內只要 50 次請求。若量測到收集太慢再加 |
| C. 逐頁收集＋佇列（本決定） | 採用 |

#### 7.4 影響的模組與檔案

- `packages/ui/src/components/Table/useTableSelection.ts`、`packages/web-core/src/components/RichTable/`（`BatchBar` 的「選取全部符合」列、收集中的進度）、`packages/web-core/src/batch/`（`run` 接受非同步 id 來源）。
- `apps/backstage/src/features/{user,role,approval}/`：列表頁提供 `collect`；`batch.ts` 的操作改為接受 id 來源。
- 語系：web-core 共用字串。
- 文件：`frontend/07-ui-system.md` §6.2、§13（新增決定，D 編號接續 D12）。

#### 7.5 遷移步驟與測試

- 只有前端；沒有資料遷移、沒有新端點。
- 單元：收集器的分頁、中止、上限；模式切換（取消勾選回到明確選取、篩選改變清除）。
- 頁面：三個權限案例不變；選取全部後送出的筆數等於總數；收集到一半中止不送出任何請求。
- E2E：使用者列表篩選出 > 1 頁 → 選取全部 → 停用 → 全部完成且失敗清單為空。

---

### 8. 檔案列表無限捲動的 `maxPages`

#### 8.1 背景

現況：`apis/file/get-file-list/query.ts` 的 `infiniteQueryOptions` 只有 `getNextPageParam`（游標只能往後），沒有 `maxPages`；
`useFileListData.ts` 合併所有頁；`useBrowserRows.ts` 以 TanStack Virtual 依「列」虛擬化（格狀時一列多個項目），超過 40 列才啟用。
推播只讓相關資料夾的查詢失效，但 TanStack 重新驗證無限查詢時會 **依序** 以游標重抓所有已載入的頁：捲到第 30 頁時，一次推播＝30 個連續請求。
後端游標（`file.cursor.ts`）是 `[sortField, order, value, id]`，`id` 一律遞減；只有 `nextCursor`。

#### 8.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **延後**。觸發條件：① 有租戶的單一資料夾常態超過約 2 000 個檔案（一般 `pageSize` 下約 20–40 頁），或 ② 使用者回報捲到深處時推播造成卡頓、列表跳動 | 目前的檔案量下重抓的頁數有限；這個改動要同時動後端游標與虛擬捲動的錨定，風險不小 |
| D2 | **屆時的設計**：`maxPages = 10`；後端回應加 `prevCursor`（第一筆之前），游標加方向旗標（`[…, 'before']`），`before` 時比較方向與排序反轉、取回後再反轉；前端加 `getPreviousPageParam` | TanStack Query v5 的 `maxPages` 需要雙向游標才能把丟掉的頁抓回來 |
| D3 | **捲動錨定以「絕對索引」解決**：虛擬列表的項目索引改為「已丟棄的筆數 ＋ 頁內索引」，被丟掉的頁以等量的佔位列保留高度；捲進佔位區時 `fetchPreviousPage`。格狀排列的每一列由絕對索引計算，丟頁不會讓後面所有項目換列 | 若直接移除前面的頁，格狀列表的每一列都會重排（頁大小不是欄數的倍數時），捲動位置必然跳動；保留佔位比事後校正 `scrollTop` 穩定 |
| D4 | 屆時也要處理「總筆數只來自第 0 頁」（`useFileListData.ts`）：丟掉第 0 頁後仍保留最後一次的 `total` | 避免頁首的筆數消失 |

在那之前的緩解（不改游標，S）：無限查詢的頁數超過 10 頁時，推播的失效改為 `refetchType: 'none'`（標記過期、不立刻重抓），使用者捲動或回到分頁時才重抓。是否要先做這個緩解，交給實作時量測決定。

#### 8.3 影響的模組與檔案（屆時）

`apps/api/src/modules/file/file.cursor.ts`、`file.repository.ts`（`afterCursor` 加反向）、`dto/list-file.dto.ts`、OpenAPI 與 SDK；
`apps/backstage/src/apis/file/get-file-list/query.ts`、`features/file/pages/FileManager/useFileListData.ts`、`useBrowserRows.ts`；
文件 `backend/09-file.md` §6.1、`frontend/12-file-manager.md` §5。測試：游標雙向的整合測試（插入、刪除穿插時不重複不遺漏）、捲動錨定的元件測試（丟頁前後同一個項目的位置不變）。

---

### 9. 列表的 304／ETag

#### 9.1 背景

**現況更正**：提案寫「每次重抓都回完整資料」，但 api 沒有關掉 Express 的 ETag（`main.ts` 只設 `trust proxy` 與 `x-powered-by`；Express 5 預設 `etag: 'weak'`，Nest 的 express adapter 以 `res.json` 回應）。
所以所有 JSON 的 `GET` 回應本來就帶「回應內容雜湊」的弱 ETag，請求帶 `If-None-Match` 且相同時 Express 回 `304`；
前端的 `fetch` 沒有指定 `cache`，回應也沒有 `Cache-Control`，瀏覽器的 HTTP 快取多半已經在做條件式請求。（從程式碼推得，實作第一步以瀏覽器與 `curl` 驗證。）

也就是說，**頻寬的節省大概已經有了；沒有省下的是伺服器的工作**——查詢、權限計算、序列化每次都做完才算雜湊。
要省伺服器的工作，就要在查詢之前判斷「沒變」，需要列表層級的版本：每個資源每個租戶一個 revision，而且 ETag 還要含權限（資料夾的 `capabilities`、角色、`authz` 的 revision）、使用者與查詢參數，任何一個漏掉都會回出過時或別人的資料。

另一面是隱私：沒有 `Cache-Control` 的 API 回應會被瀏覽器存進磁碟快取，登出後仍留在共用電腦上，與 [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2「不放伺服器資料的複本」的精神不一致。對外 API（`deploy/nginx.external-api.conf`）已經是 `no-store`。

#### 9.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **不做列表層級的版本**。觸發條件：量測顯示重新驗證的尖峰（部署後重連、推播失效）以資料庫時間為主要成本，且快取命中率高（同一份列表被同一個人反覆重抓而沒變） | 正確性的風險（ETag 漏掉權限或使用者）大於目前可見的收益；租戶連線池與查詢逾時已有保護 |
| D2 | **API 回應明確設定 `Cache-Control`**（全域 interceptor，只對 `/api` 的 JSON 回應；影像 API 的 302 維持自己的 `private, max-age`）。值見 §9.4 | 行為明確，不依賴瀏覽器的啟發式規則；決定資料要不要留在磁碟 |
| D3 | **單筆資源也不加 `ETag: W/"<version>"`**（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D3 留下的選項） | 與 D1 同理；樂觀鎖的 `version` 走 body 已足夠 |
| D4 | **屆時（D1 觸發）的設計**：每個「租戶 × 資源類型」一個單調遞增的 revision（寫入的交易提交後遞增，經 `core/broadcast` 跨程序同步，同 `AuthzRevision` 的做法）；ETag = `hash(資源 revision, authz revision, 使用者 id, 正規化的查詢參數)`；guard 之後、查詢之前比對 `If-None-Match`；只對「回應只依賴該資源與權限」的列表啟用，逐一宣告 | 把判斷放在查詢之前才省得到工作；逐一宣告避免把依賴其他資源的列表（例：使用者列表帶角色名稱）誤判為沒變 |

#### 9.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| A. 維持現狀（Express 預設 ETag、沒有 `Cache-Control`） | 不採用：磁碟快取的行為不明確 |
| B. `no-store` ＋ 關掉 Express ETag | 見 §9.4 |
| C. `private, no-cache` ＋ 保留 Express ETag | 見 §9.4 |
| D. 列表層級版本（D4） | 延後，見 D1 |

#### 9.4 待使用者決定

- **API 的 `Cache-Control` 用 `no-store` 還是 `private, no-cache`**：
  - `no-store`（同時 `app.set('etag', false)` 省下雜湊）：回應不進磁碟快取，登出後不留痕跡；代價是失去現在大概已經有的 304 頻寬節省（列表以 gzip 後通常只有數 KB 到數十 KB）。
  - `private, no-cache`：保留 304；回應仍存在瀏覽器的磁碟快取。
  - **建議 `no-store`**：後台資料敏感、頻寬不是瓶頸，與 09 §4.2 和對外 API 一致。規模 S（一個 interceptor ＋ 一行設定 ＋ 整合測試確認標頭）。

#### 9.5 影響的模組與測試

`apps/api/src/main.ts`（`etag`）、`apps/api/src/core/http/`（`Cache-Control` interceptor）、`modules/file/file.controller.ts`（影像 API 維持自己的標頭）；
文件 `backend/03-api-conventions.md`（新增「HTTP 快取」一節）、`backend/14-revisions.md` §9.2 D3 註明結論。
測試：整合測試確認 `/api` 的 `GET` 帶選定的 `Cache-Control`、影像 API 不被覆寫；若選 `no-store`，確認沒有 `ETag`。

---

### 10. 每個租戶覆寫連線池、PgBouncer、影像處理的記憶體實測

結論：**三項現在都不做**。以下是觸發條件與屆時的前置作業。

#### 10.1 每個租戶覆寫連線池大小

- 現況：每個租戶一個 postgres.js 池，`TENANT_POOL_MAX` 全域一個值（預設 10）、閒置 30 秒關閉，池物件不回收（`core/tenant/tenancy.service.ts`）；
  預算公式 `(平台池 ＋ 4 ＋ 1 ＋ 同時活躍的租戶數 × TENANT_POOL_MAX) × api 程序數 ＋ migrate／腳本 ＜ max_connections − 3`（[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2）。
- **觸發條件**：某個租戶的池出現排隊（要先有 `observability.md` 的「池等待數／等待時間」指標），或單一租戶的同時在線明顯超過 1000 人，而其他租戶遠小於它。
- **屆時**：feature 參數 `db.poolMax`（範圍 2–50，[`05-tenancy.md`](../architecture/05-tenancy.md) §13），`Tenancy.poolOf` 建池時讀它、參數改變時以與「連線字串改變」相同的方式換池；預算公式的「同時活躍的租戶數 × `TENANT_POOL_MAX`」改為逐租戶加總。

#### 10.2 PgBouncer

- **觸發條件**（任一）：預算公式的左邊超過 `max_connections` 的約 70%；或多實例上線、api 程序數 ≥ 2 且同時活躍的租戶超過 10 個；或 postgres 的記憶體因連線數成為瓶頸。
- **屆時的前置作業**（現在的程式有三處與 transaction mode 不相容）：
  1. postgres.js 預設使用具名 prepared statements，經 PgBouncer 的連線要設 `prepare: false`（`core/database/database.provider.ts` 的 `postgresOptionsOf`）。
  2. `statement_timeout`、`idle_in_transaction_session_timeout` 現在以連線的 startup 參數設定；PgBouncer 不轉送任意 startup 參數，要改成 `ALTER ROLE … SET`（或租戶 database 層級）並在佈建時設定。
  3. `core/broadcast` 的 `LISTEN` 連線與 pg-boss 需要 session 語意：**只有租戶 DB 經過 PgBouncer**，平台 DB 維持直連。
  已經相容的部分：程式只用交易層級的 `pg_advisory_xact_lock`（資料夾樹鎖），沒有以 `SET`／`SET LOCAL` 保留的 session 狀態。

#### 10.3 影像處理的記憶體實測

- 現況：`IMAGE_VARIANT_CONCURRENCY = 2`（程式常數，每程序）、`sharp` 的 libvips 執行緒 2、快取 16 MB、`sequentialRead`、輸入上限 1 億像素、原圖先串流到暫存檔（[`backend/09-file.md`](../architecture/backend/09-file.md) §5.4）；
  api 容器 `API_MEM_LIMIT` 預設 2g、`--max-old-space-size` 1536。
- **觸發條件**（任一）：要調高 `IMAGE_VARIANT_CONCURRENCY` 或調低 api 的記憶體上限；影像變體移到獨立 worker（`multi-instance.md`）時決定 worker 的記憶體規格；正式環境出現 OOM 或 RSS 持續接近上限。
- **屆時的量測方式**：在與正式相同的容器限制下，以三類檔案（1 億像素的 PNG、大尺寸漸進式 JPEG、含透明的大圖）各跑「並行 = 1、2、4」，記錄 RSS 峰值（`process.memoryUsage().rss` 與 cgroup 的 `memory.peak`）與耗時；
  同時跑登入壓測確認與 argon2（§3 D6）共用 threadpool 時互不拖累。結果寫回 09-file §5.4，作為並行數與容器記憶體的依據。

## 歸檔去向

- 資安項目：`docs/architecture/backend/04-auth.md`、`09-file.md`、`docs/architecture/04-sso.md`
- 容量項目：`docs/architecture/backend/02-database.md`、`09-file.md`、`10-jobs.md`
- 前端項目：`docs/architecture/frontend/` 對應章節
