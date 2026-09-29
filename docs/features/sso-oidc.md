# SSO（OIDC）

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 5 項、[ADR-0004](../adr/0004-jwt-with-rotating-refresh-token.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

公司內部使用時，帳號通常由 Google Workspace、Azure AD 等身分提供者管理。
目前只有帳號密碼登入，人員離職要另外停用。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| OIDC 登入（Authorization Code ＋ PKCE） | SAML、LDAP |
| 第一次登入時依 email 對應既有帳號，或走審批建立 | SCIM 自動佈建 |
| 登入後沿用現有的 access token ＋ refresh token 流程 | |
| 可設定「只允許 SSO」停用密碼登入 | |

## 開放問題

1. 未對應到既有帳號的人：自動建立、走審批（`user.register`），還是拒絕？
2. 身分提供者的群組要不要對應到角色？
3. 提供者設定放 env 還是 [`system-settings.md`](./system-settings.md)？

## 歸檔去向

- `docs/adr/NNNN-oidc-login.md`、`docs/architecture/backend/04-auth.md` 新增章節
