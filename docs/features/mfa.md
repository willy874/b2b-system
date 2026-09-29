# MFA（雙因素驗證）

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 3 項

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

`users.mfa_enabled` 已預留（`apps/api/src/db/schema/users.ts`），流程未實作。
管理員帳號能改權限，只靠密碼風險偏高。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| TOTP（驗證器 App）設定、驗證、停用 | 簡訊 OTP |
| 一次性備用碼 | |
| 可要求特定角色必須啟用 | |
| 管理員重設他人的 MFA（寫稽核） | |

## 初步構想

- 登入改為兩段：密碼通過後拿到短效的「待驗證」憑證，驗過 TOTP 才核發 access token
- TOTP 密鑰加密存放；備用碼只存雜湊
- 失敗次數併入既有的帳號鎖定

## 開放問題

1. WebAuthn／Passkey 要不要一起做？
2. 「特定角色必須啟用」的設定放在角色上，還是 [`system-settings.md`](./system-settings.md)？

## 歸檔去向

- `docs/architecture/backend/04-auth.md` 新增章節、前端 `features/account`
