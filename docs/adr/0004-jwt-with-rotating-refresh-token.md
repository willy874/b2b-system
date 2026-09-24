# ADR-0004 — 短期 JWT ＋ 輪替式 Refresh Token

- 狀態：**提案中（待確認）**
- 日期：2026-09-19
- 相關：[`../architecture/backend/04-auth.md`](../architecture/backend/04-auth.md)、[`../architecture/frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md)

## 背景

需要決定 session 的表示方式。三個常見選項：伺服器 session（cookie + 儲存）、
長期 JWT、短期 JWT ＋ refresh token。

## 決定

- **Access Token**：JWT，5 分鐘，只存客戶端記憶體，內容只有 `{ sub, ver, jti }`
- **Refresh Token**：不透明隨機值，7 天，`httpOnly` cookie，
  雜湊後入庫，**每次使用即輪替**，**重用偵測 → 整條家族撤銷**
- **撤銷機制**：`users.token_version`，遞增即讓所有既存 access token 失效
- **跨分頁**：前端用 Web Locks（`navigator.locks`）互斥續期，確保同時只有一個分頁在輪替；
  `BroadcastChannel` 只負責分享新 token 與同步登出

## 理由

1. **Access token 不進 `localStorage`。** XSS 拿不到可長期使用的憑證。
   代價是重新整理頁面需要一次 refresh（約 50 ms）。
2. **Refresh token 是不透明值而非 JWT。** 它不需要攜帶資訊；換成 DB 查詢
   得到的是 **可撤銷性** 與 **重用偵測**，那是 JWT 做不到的。
3. **輪替 ＋ 家族撤銷是被竊取時的唯一補救。** 攻擊者用了偷來的 token，
   合法使用者下次續期就會觸發重用偵測；反之亦然。任一方先用都會讓整條家族失效。
4. **`token_version` 補上 JWT 的撤銷缺口。** 停用使用者、改密碼時遞增，
   既存 token 下一次請求即失效，不需要等 5 分鐘。
5. **5 分鐘是延遲與成本的平衡點。** 更短會讓續期請求變多；更長會拉大
   `token_version` 檢查之外的空窗（實際上有 `token_version` 就沒有空窗，
   5 分鐘只影響「快取的使用者狀態」的新鮮度）。

## 代價

| 代價                                                 | 緩解                                                     |
| ---------------------------------------------------- | -------------------------------------------------------- |
| **跨分頁必須協調**，否則會誤判為重用攻擊並登出使用者 | Web Locks 互斥（拿到鎖時 cookie 已是新的）；後端以條件式 `UPDATE` 保證同一張 token 只換發一次 |
| 每個請求都要驗簽 ＋ 查使用者狀態                     | `UserCacheService` TTL 30 秒                             |
| 重新整理頁面多一次往返                               | 約 50 ms，可接受                                         |
| 實作複雜度高於伺服器 session                         | 這是主要代價；但 §3 的重用偵測是伺服器 session 給不了的  |

## 替代方案

| 方案                                | 不採用的理由                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 伺服器 session（cookie + DB/Redis） | 更簡單且天然可撤銷。但每個請求都要查 session store，且未來若要支援非瀏覽器客戶端（CLI、CI）需要另做一套 |
| 長期 JWT（無 refresh）              | 無法撤銷。管理員停用一個帳號後那個人還能用到 token 過期                                                 |
| Access token 帶權限                 | 見 [ADR-0005](./0005-permission-resolved-server-side.md)                                                |
| Refresh token 不輪替                | 被竊取後無從察覺                                                                                        |
| Refresh token 存 `localStorage`     | XSS 直接拿走長期憑證                                                                                    |
