# 功能導覽

> 一頁一頁看 B2B System 現在能做什麼，以及每個畫面背後的規則。規格細節以各章節文件為準，這裡只導覽並附上連結。
>
> 截圖由 E2E 的導覽劇本自動拍攝（`apps/e2e/tour/`）：重置資料庫、跑 seed、以 API 建立示範資料，再用 Playwright 逐頁操作。
> 畫面改版後重跑一次即可更新，見文末〈[重新產生截圖](#重新產生截圖)〉。帳號、名稱與數字都是示範資料。

## 目錄

1. [登入](#1-登入)
2. [人員與權限](#2-人員與權限)：使用者、角色、群組、權限目錄、服務帳號
3. [檔案、審批、標籤](#3-檔案審批標籤)
4. [稽核與維運](#4-稽核與維運)：稽核日誌、回收桶、版本紀錄、背景工作、系統設定、外部 IdP
5. [通知與對外](#5-通知與對外)：站內通知、公告、Webhook
6. [平台後台（apps/platform）](#6-平台後台appsplatform)
7. [個人帳號與介面](#7-個人帳號與介面)

先看一眼全貌：租戶的後台（`apps/backstage`）分三組選單——「功能管理」放業務功能（目前是檔案），「人員管理」放身分與權限，「系統管理」放維運與設定。
選單只列出目前使用者有權限、而且租戶有啟用的項目。

![首頁](./images/tour/home.jpg)

*super-admin 的首頁。頂列由左到右是批次處理佇列、即時連線狀態、語言、主題、通知與帳號選單；頂列工具可以在偏好設定裡排序與隱藏。*

---

## 1. 登入

後台沒有自己的登入頁。打開 backstage，會被導到 `apps/platform` 的登入互動頁（OIDC 授權碼 ＋ PKCE），登入後帶著授權碼回到原本的網址。
同一個入口服務所有租戶與產品，畫面上寫明正在登入哪個租戶、哪個產品。

| ![登入互動頁](./images/tour/login.jpg) | ![申請帳號](./images/tour/register.jpg) |
| --- | --- |
| *登入互動頁。輸入 email 後，若網域登記在某條外部 IdP 連線上，會出現以該 IdP 登入的按鈕。* | *申請帳號。送出後進入審批，核准才建立帳號；系統設定可以關閉這個入口。* |

- 密碼錯誤 5 次鎖定 15 分鐘（次數與時間可在系統設定調整），但 **不踢掉既有的 session**：否則任何人猜錯 5 次就能把線上的管理者踢下線。
- 忘記密碼一律回「已寄出」，回應時間與帳號是否存在無關。
- Access token 只存在記憶體；refresh token 每用一次就換新，多個分頁以 Web Locks 協調，不會互相踢掉。

規格：[`architecture/04-sso.md`](../architecture/04-sso.md)、[`architecture/backend/04-auth.md`](../architecture/backend/04-auth.md)。

---

## 2. 人員與權限

### 2.1 使用者

![使用者列表](./images/tour/user-list.jpg)

*使用者列表：搜尋、欄位排序、篩選、欄位設定（可釘選與隱藏）。狀態分啟用、停用、待啟用、鎖定；鎖定的帳號多一個解鎖鈕。自己那一列的刪除鈕是停用的。*

![跨頁選取與批次操作](./images/tour/user-batch.jpg)

*勾選幾列後出現批次操作列。批次不是一個「批次端點」，而是前端佇列逐筆呼叫單筆 API：單筆端點是業務規則的唯一來源，過時的那一筆（`version` 不符）個別失敗，不拖累其他筆。被選取帳號的「啟用」是灰的，因為它們沒有一個處於停用狀態。*

| ![建立使用者](./images/tour/user-create.jpg) | ![指派標籤](./images/tour/user-tag-assign.jpg) |
| --- | --- |
| *建立使用者不設密碼：系統寄出啟用信，由本人設定。可以一併指派角色，但只能選自己持有其全部權限的角色。* | *使用者詳情可以貼標籤；標籤的名稱與顏色在標籤管理頁統一設定。* |

![有效權限與來源](./images/tour/user-detail-explain.jpg)

*使用者詳情的「有效權限」。每個權限鍵列出所有來源路徑：Dev User 50 的 `user:read` 同時來自直接持有的「客服」「發佈管理」角色，以及「營運中心」群組持有的「營運專員」角色。
`approval:read` 後面的「由 approval:review 帶出」是權限依賴樹：持有審核就隱含能檢視。查看者看不到的群組或角色只顯示種類，不洩漏名稱。*

規格：[`rbac/04-api-spec.md`](../rbac/04-api-spec.md)、[`rbac/09-explain.md`](../rbac/09-explain.md)。

### 2.2 角色

![角色列表](./images/tour/role-list.jpg)

*角色列表。四個系統角色（藍色標籤）不可刪除、不可改名；super-admin 的權限數是 0，因為它是一條「全集」的邊，不列任何權限鍵。*

![角色詳情](./images/tour/role-detail.jpg)

*角色詳情：已授予的權限、直接持有與經由群組持有的人。底部可以複製為新角色、看版本紀錄、管理權限。*

![權限技能樹](./images/tour/role-permission.jpg)

*管理角色權限的技能樹。點一個權限就授予它，它包含的前置權限自動點亮為「已包含」（鎖頭圖示）：這裡滑到「審核申請」，路徑上的「檢視審批」以橘框標出。
你自己沒有的權限會標成「無法授予」——這就是反提權在畫面上的樣子；後端另外再檢查一次，直接打 API 回 `403 AUTHZ_ESCALATION`。*

![版本紀錄](./images/tour/role-revision.jpg)

*角色的版本紀錄。每次改名稱、說明或權限都留一版。選第 1 版、與目前內容比較：紅色是目前有、還原後會消失的，綠色是第 1 版的內容。
還原會產生第 4 版，歷史不被改寫；權限會因此改變時，還原另外要求 `role:grantPermission`，避免只有 `role:update` 的人藉還原改權限。*

![建立角色](./images/tour/role-create.jpg)

*建立角色時同樣可以展開技能樹挑權限。*

規格：[`rbac/01-domain-model.md`](../rbac/01-domain-model.md)、[`architecture/backend/14-revisions.md`](../architecture/backend/14-revisions.md)。

### 2.3 群組

| ![群組列表](./images/tour/group-list.jpg) | ![群組詳情](./images/tour/group-detail.jpg) |
| --- | --- |
| *群組列表。群組可以巢狀（全體員工 → 工程部 → 前端組），上限 6 層。* | *群組持有角色，成員（含子群組的成員）都取得這些角色。人員異動時只要改成員，不必一個個改角色。* |

把人加進群組，等於把群組持有的角色給他，所以加成員同樣受反提權限制；群組也不能持有 super-admin。
寫成員時以 advisory lock 排隊，「A 加進 B」和「B 加進 A」同時送出也不會繞過循環檢查。規格：[`rbac/08-groups.md`](../rbac/08-groups.md)。

### 2.4 權限目錄與有效權限

![權限目錄](./images/tour/permission-list.jpg)

*權限目錄（唯讀）：依資源分組，標出「你持有」。權限清單由後端 seed 管理，前後端共用同一份由 OpenAPI 產生的權限鍵。*

![權限依賴樹](./images/tour/permission-tree.jpg)

*樹狀圖檢視。基礎權限在上、包含它的在下，虛線是跨資源的依賴。選了「刪除檔案」：它包含「編輯檔案」，持有它就等於持有編輯、檢視與使用檔案管理器（橘框是路徑）。
受反提權限制的鍵（例如「指派角色」）不能被任何鍵包含，這條規則在程序啟動時驗證。*

規格：[`rbac/02-permission-catalog.md`](../rbac/02-permission-catalog.md) §9。

### 2.5 服務帳號與 API token

| ![服務帳號列表](./images/tour/service-account-list.jpg) | ![服務帳號詳情](./images/tour/service-account-detail.jpg) |
| --- | --- |
| *服務帳號給 CI、報表、其他系統使用：不能登入後台，只能以 API token 呼叫對外 API。* | *服務帳號持有角色；它的 token 最多只能做到這些角色允許的事。* |

![token 只顯示一次](./images/tour/service-account-token-created.jpg)

*建立 token 後，完整的值只顯示這一次。清單裡只留 token id 與 secret 的前 4 碼供辨識；資料庫只存雜湊。
token 的格式是 `b2bt_<租戶>_<id>_<secret>`，固定的開頭可以登記到 GitHub 等平台的 secret scanning。*

個人也可以在個人資料頁建立自己的 token。對外 API 是獨立的程序與網域（`/v1`），只認 API token。規格：[`architecture/06-external-api.md`](../architecture/06-external-api.md)。

### 2.6 沒有權限時

![深連結的 403](./images/tour/forbidden.jpg)

*一般成員直接打開 `/role/create`：登入後回到原網址，顯示 403 而不是被導回首頁，方便拿網址請管理者開通；選單只剩他看得到的項目。
權限水合前畫面顯示骨架屏，不會先閃出內容再消失。*

規格：[`architecture/frontend/06-permission.md`](../architecture/frontend/06-permission.md)。

---

## 3. 檔案、審批、標籤

### 3.1 檔案管理器

![資料夾內容](./images/tour/file-folder.jpg)

*檔案管理器。左邊是資料夾樹（共用資料夾、私人資料夾），右邊是內容；依類型、標籤篩選，依時間或名稱排序。
檔案內容不經過 api：瀏覽器拿 presigned URL 直傳物件儲存，大檔分塊、每塊各自重試。縮圖是伺服器產生的影像變體。*

| ![清單檢視](./images/tour/file-list-view.jpg) | ![預覽](./images/tour/file-preview.jpg) |
| --- | --- |
| *清單檢視。可以框選、Shift／Ctrl 多選、拖曳到資料夾上移動、從電腦拖整個資料夾上傳。* | *預覽：圖片、文字、PDF 等；左右切換同資料夾的檔案。* |

![共用資料夾](./images/tour/file-share.jpg)

*資料夾授權。可以授權給使用者、群組或角色，等級分檢視者、貢獻者、編輯者、管理者，可設到期日；授權會繼承到所有子資料夾，也可以關閉繼承變成私人資料夾。
「檢查存取」選一位使用者，就顯示他在這個資料夾能做什麼、經由哪條授權。*

- 上傳時宣告的大小在 `complete` 時比對，不符就刪除物件；HTML、JS、PDF 等型別強制下載並帶 `CSP sandbox`，上傳的檔案偷不到 cookie。
- 影像變體去除 EXIF 的 GPS；`<img>` 用 HMAC 簽章網址授權，同一時間窗網址不變，瀏覽器快取命中。
- 關掉分頁上傳不會斷：佇列跑在 SharedWorker，其他分頁接手。

規格：[`architecture/backend/09-file.md`](../architecture/backend/09-file.md)、[`architecture/frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md)、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)。

### 3.2 審批

| ![審批列表](./images/tour/approval-list.jpg) | ![審批詳情](./images/tour/approval-detail.jpg) |
| --- | --- |
| *需要核准才生效的申請：帳號註冊、資料夾存取申請。* | *核准時可以一併指派角色；審核意見記錄在稽核日誌。* |

**核准等同代為執行**：審核者自己必須做得到那個操作（例如核准註冊要能建立使用者、指派的角色要通過反提權），否則 `approval:review` 會變成後門。
另有四眼原則，不能審自己的申請。規格：[`rbac/06-approval.md`](../rbac/06-approval.md)。

### 3.3 標籤

![標籤管理](./images/tour/tag-list.jpg)

*標籤依資源類型分開管理（使用者、檔案），各自有名稱與顏色；列表可以依標籤篩選。貼與移除標籤跟著目標資源的編輯權限走。
新的資源類型由擁有它的模組登記，標籤模組不必認識業務模組。*

規格：[`architecture/backend/18-tag.md`](../architecture/backend/18-tag.md)。

---

## 4. 稽核與維運

### 4.1 稽核日誌

![稽核日誌](./images/tour/audit-log.jpg)

*所有寫入操作與授權決策。紀錄和業務寫入在同一個交易：寫不進去，整個操作就失敗。應用程式的 DB 角色只有 INSERT 與 SELECT，trigger 擋下 UPDATE／DELETE。*

| ![展開一筆紀錄](./images/tour/audit-log-expanded.jpg) | ![篩選](./images/tour/audit-log-filter.jpg) |
| --- | --- |
| *展開一筆紀錄：左邊是變更前後差異（只記實際變更的欄位），右邊是 IP、requestId、User-Agent 等中繼資料。操作者的 email 與資源名稱是快照，人被刪了紀錄仍看得懂。* | *依動作（支援前綴，如 `role.*`）、資源、結果、時間範圍篩選。熱表保留 90 天，之後搬到壓縮的冷表。* |

規格：[`architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)。

### 4.2 回收桶與版本紀錄

| ![回收桶：使用者](./images/tour/trash.jpg) | ![回收桶：角色](./images/tour/trash-role.jpg) |
| --- | --- |
| *使用者、角色、群組、檔案、資料夾、公告刪除後進回收桶，保留期內可以還原。* | *還原會重新檢查唯一值（名稱被佔用回 409）與反提權。到期由排程逐列永久刪除，一列被外鍵卡住只略過它自己。* |

可編輯的實體都有 `version`：更新必須帶上讀取時的版本，別人先改了就回 409，畫面保留使用者的輸入。版本紀錄見 [§2.2](#22-角色)。
規格：[`architecture/backend/13-trash.md`](../architecture/backend/13-trash.md)、[`architecture/backend/14-revisions.md`](../architecture/backend/14-revisions.md)、[`architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11。

### 4.3 背景工作

![背景工作](./images/tour/job.jpg)

*每個佇列一張卡片：排程（cron，UTC）或由程式入列，等待、排定、執行中、完成的數量。稽核封存、檔案維護、回收桶清除、版本修剪、通知清理都是排程工作。*

![工作詳情](./images/tour/job-detail.jpg)

*展開一筆工作：左邊是工作資料，右邊是執行結果或錯誤。這筆是 Webhook 投遞到不存在的網址（`ENOTFOUND`），會自動重試；重試用完停在「失敗」，可以手動重試。*

佇列用 pg-boss，放在平台 DB；業務交易在租戶 DB，所以交易內入列先寫租戶 DB 的 `job_outbox`，提交後搬進佇列，漏搬的由排程補上。
寄信的 token 在寄出當下才簽發，持有 `job:read` 的人從工作資料看不到可用的連結。規格：[`architecture/backend/10-jobs.md`](../architecture/backend/10-jobs.md)、[`architecture/backend/11-mail.md`](../architecture/backend/11-mail.md)。

### 4.4 系統設定與外部 IdP

![系統設定](./images/tour/setting.jpg)

*每個租戶在執行期可調的設定：預設時區、登入鎖定、密碼長度、是否開放註冊、啟用信與重設密碼信的效期、API token 的最長效期、上傳上限、回收桶與版本的保留、通知與公告的上限……。每個值都有允許的範圍，不能設出削弱安全性的值（例如密碼最短長度不能低於 12）；修改即時生效並記入稽核。*

| ![外部 IdP 連線](./images/tour/identity-provider.jpg) | ![新增連線](./images/tour/identity-provider-form.jpg) |
| --- | --- |
| *租戶自己的外部 IdP（OIDC）連線，例如公司的 Azure AD、Google Workspace。* | *登記 issuer、client、scopes 與 email 網域；找不到對應帳號時拒絕登入，或自動建立帳號。* |

以 email 自動連結既有帳號時，要求 `email_verified`、網域登記在這條連線上、而且帳號沒有 member 以外的系統角色——否則能改 IdP 設定的人可以自架 IdP 簽出 super-admin 的 email。
規格：[`architecture/backend/12-settings.md`](../architecture/backend/12-settings.md)、[`architecture/04-sso.md`](../architecture/04-sso.md)。

---

## 5. 通知與對外

### 5.1 站內通知

![鈴鐺](./images/tour/notification-bell.jpg)

*頂列的鈴鐺與未讀數。這兩則是有人送出註冊申請，通知給所有可以審核的人；點開直接到審批詳情。通知是推播到瀏覽器的，不必重新整理。*

| ![通知列表](./images/tour/notification-list.jpg) | ![通知總覽](./images/tour/notification-overview.jpg) |
| --- | --- |
| *自己的通知：全部／未讀、全部已讀；已讀超過保留期限的自動清除。* | *管理者的通知總覽：租戶內所有人收到的通知與已讀狀態。* |

![事件通知](./images/tour/notification-events.jpg)

*事件通知：每種事件可以分管道（站內、Email）開關，並決定是否允許個人關閉。關掉再打開不補發。事件目錄寫在程式碼裡，資料庫只存租戶層的覆寫。*

通知由擁有者模組在業務交易內寫入，不訂閱程序內的事件匯流排（那是 fire-and-forget，會丟）。通知存的是 route id 加參數而不是網址：
功能被停用或路徑改名時只顯示文字，不給壞掉的連結。規格：[`architecture/backend/15-notification.md`](../architecture/backend/15-notification.md)、[`architecture/backend/16-notification-event.md`](../architecture/backend/16-notification-event.md)。

### 5.2 公告

| ![公告列表](./images/tour/announcement-list.jpg) | ![建立公告](./images/tour/announcement-create.jpg) |
| --- | --- |
| *公告列表：一則已立即發送、一則每週一 09:00 的週期公告。* | *收件對象可以是全部、指定的人、群組（含子群組）或角色，即時算出會發給幾人；發送時間有立即、指定時間、週期、事件發生時（帳號啟用、被指派角色、加入群組）。* |

![公告詳情與發送紀錄](./images/tour/announcement-detail.jpg)

*公告詳情：每次發送一筆紀錄，顯示已讀／收件人數，可以撤回。週期依租戶的預設時區計算。*

| ![收件人的鈴鐺](./images/tour/announcement-bell.jpg) | ![公告全文](./images/tour/announcement-message.jpg) |
| --- | --- |
| *一般成員收到公告。* | *點開通知看全文。* |

規格：[`architecture/backend/19-announcement.md`](../architecture/backend/19-announcement.md)、[`architecture/frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)。

### 5.3 Webhook

| ![Webhook 列表](./images/tour/webhook-list.jpg) | ![建立 Webhook](./images/tour/webhook-create.jpg) |
| --- | --- |
| *Webhook 列表：事件數、連續失敗次數、最後投遞時間。* | *選擇要訂閱的事件與目標網址（可以多個）；簽章用的 secret 只在建立時顯示一次。* |

![Webhook 詳情](./images/tour/webhook-detail.jpg)

*Webhook 詳情：訂閱的事件、連續失敗次數與投遞紀錄。示範資料的目標網址不存在，所以每一次投遞都是 `ENOTFOUND`，第 1 次之後自動重試。*

![投遞內容](./images/tour/webhook-delivery.jpg)

*投遞紀錄與內容。payload 只帶 id 與列舉值、不帶個資，接收端要細節時以 API token 經對外 API 回查，套用的是 token 自己的權限；外洩的影響因此很小。每次投遞帶 HMAC 簽章；失敗自動重試（最多 8 次，間隔逐漸拉長到 1 小時），連續失敗太多次自動停用並通知能修好它的人，也可以手動重送。*

目標網址在連線時才解析並綁定已驗證的位址，擋下指向內網或 metadata 服務的 SSRF。規格：[`architecture/backend/17-webhook.md`](../architecture/backend/17-webhook.md)。

---

## 6. 平台後台（apps/platform）

平台管理者是另一份帳號（平台 DB 的 `platform_admins`），登入同一個入口，但沒有任何租戶的授權。平台的端點只在 apps/platform 的網域有效，
其他網域一律回 `404 PLATFORM_ONLY`，WAF 與 IP 白名單只要套在一個網域上。

![平台首頁](./images/tour/platform-home.jpg)

*平台首頁：各狀態的租戶數。*

### 6.1 租戶

| ![租戶列表](./images/tour/platform-tenant-list.jpg) | ![建立租戶](./images/tour/platform-tenant-create.jpg) |
| --- | --- |
| *租戶列表。* | *建立租戶：代碼、名稱、第一位管理員的 email。佈建在背景進行（建 database、DB 角色、bucket、跑 migration），完成後寄啟用信給管理員。* |

![租戶概覽](./images/tour/platform-tenant-overview.jpg)

*租戶概覽與網域。每個租戶一個 database 與一組網域，請求由網域決定租戶；沒有租戶脈絡時直接拋錯，不退回預設資料庫。*

![租戶的功能](./images/tour/platform-tenant-features.jpg)

*為租戶開關功能、設定配額（檔案容量、稽核熱資料天數、同時執行的工作數、外部 IdP 連線數、Webhook 網址數）。
關掉的功能在 API 回 `404 FEATURE_DISABLED`，前端在執行期卸載該 feature；資料不刪，重新打開即恢復。*

生命週期是 provisioning → active／failed → disabled → deleted，每一步冪等；佈建到一半程序重啟，排程會把卡住的租戶收成 failed。
規格：[`architecture/05-tenancy.md`](../architecture/05-tenancy.md)。

### 6.2 平台管理者、feature flag 與平台稽核

| ![平台管理者](./images/tour/platform-admin.jpg) | ![試行開關](./images/tour/platform-feature-flag.jpg) |
| --- | --- |
| *平台管理者分 super-admin、operator、auditor 三種角色。* | *試行開關（feature flag）：先開給試用的租戶，穩定後全面開放，最後連同開關一起移除。每個 flag 必填預計移除日，過期沒移除會讓測試失敗。目前沒有試行中的功能。* |

| ![平台稽核](./images/tour/platform-audit-log.jpg) | ![全平台的背景工作](./images/tour/platform-job.jpg) |
| --- | --- |
| *平台層的稽核：租戶與管理者的操作。* | *全平台的背景工作：佇列在平台 DB，排程工作展開成每個租戶一筆，一個租戶塞車不影響其他租戶。* |

規格：[`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §10–11。

---

## 7. 個人帳號與介面

| ![個人資料](./images/tour/profile.jpg) | ![偏好設定](./images/tour/preference.jpg) |
| --- | --- |
| *個人資料：顯示名稱、變更密碼、自己的有效權限與來源、個人 API token。* | *語系與時區同步到帳號；主題與頂列工具只存在這台裝置；可以關閉管理者允許關閉的通知。* |

### 深色主題

| ![深色的使用者列表](./images/tour/dark-user-list.jpg) | ![深色的權限樹](./images/tour/dark-permission-tree.jpg) |
| --- | --- |
| *Design Token 分三層，深色只覆寫 alias 層；狀態色分填色與前景兩組，兩個主題都通過 WCAG 對比測試。* | *樹狀圖沒有載入第三方 CSS，跟著 token 一起換色。* |

![深色的版本差異](./images/tour/dark-role-revision.jpg)

*主題預設「跟隨系統」；`theme-init.js` 在首次繪製前決定主題，不閃白。*

規格：[`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4。

---

## 重新產生截圖

導覽劇本在 `apps/e2e/tour/`：`demo-data.ts` 以 API 建立示範資料，`feature-tour.spec.ts` 逐頁拍照，輸出到 `docs/overview/images/tour/`。
它會 **重置資料庫**，所以要對著隔離的環境跑（做法同 [`frontend/10-testing.md`](../architecture/frontend/10-testing.md) §4.3「與正在跑的 dev 環境並行」）：
先依該節起好暫用的 postgres、api、file-storage、backstage、platform 與環境變數，再執行：

```bash
pnpm --filter @b2b-system/e2e tour
```

- 某一張拍不到時劇本不中斷，最後列出沒拍到的畫面；畫面改版通常只要調整那一段的 testid。
- 新增功能時在劇本加一個 `scene`、在本文加一段說明。截圖是 JPEG（1440×900），整份約 5 MB。
