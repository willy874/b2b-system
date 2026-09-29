# 使用者群組

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`workspace.md`](./workspace.md)、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

資料夾授權的對象目前是「角色」或「使用者」。角色帶權限，拿來當分組會讓角色數量爆炸
（「美術組-A 專案」「美術組-B 專案」…）；逐個使用者授權則難以維護。
群組是「不帶權限、純分組」的概念：授權給群組，人員異動只改群組成員。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 群組 CRUD、成員管理 | 巢狀群組 |
| 群組可當角色指派與資源授權的對象 | 從 SSO／LDAP 同步群組（等 [`sso-oidc.md`](./sso-oidc.md)） |

## 開放問題

1. 若 [`workspace.md`](./workspace.md) 採用工作區角色，群組是否還有必要？
2. 群組指派角色後，權限快取的失效範圍怎麼算？

## 歸檔去向

- `docs/rbac/01-domain-model.md`、`rbac/07-resource-grants.md` §1
