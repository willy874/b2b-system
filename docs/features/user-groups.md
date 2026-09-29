# 使用者群組

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`tenant-isolation.md`](./tenant-isolation.md)、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

資料夾授權的對象目前是「角色」或「使用者」。角色帶權限，拿來當分組會讓角色數量爆炸
（「美術組-A 專案」「美術組-B 專案」…）；逐個使用者授權則難以維護。
群組是「不帶權限、純分組」的概念：授權給群組，人員異動只改群組成員。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 群組 CRUD、成員管理 | 巢狀群組 |
| 群組可當角色指派與資源授權的對象 | 從 SSO／LDAP 同步群組（SSO 見 [`../architecture/04-sso.md`](../architecture/04-sso.md)；外部 IdP 的群組對應是後續工作） |

## 開放問題

1. 若 [`tenant-isolation.md`](./tenant-isolation.md) 之後每個租戶的使用者變少，群組是否還有必要？（工作區角色已隨 ADR-0020 取消）
2. 群組指派角色後，權限快取的失效範圍怎麼算？

## 歸檔去向

- `docs/rbac/01-domain-model.md`、`rbac/07-resource-grants.md` §1
