# 權限圖（Relationship-based Access Control）：G5 專案

- 優先度：P3
- 狀態：提案（G0～G4b 已上 main 並歸檔；剩 G5，等專案功能）
- 依賴：專案功能本身（尚無提案）
- 相關：[ADR-0024](../adr/0024-relationship-based-access-control.md)（本功能的決策）、
  [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4（圖的組成與模型）、
  [`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §10（資源怎麼加入關係圖）、
  [`rbac/08-groups.md`](../rbac/08-groups.md)（群組）、[`rbac/09-explain.md`](../rbac/09-explain.md)（說明）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 已上線的部分

| 階段 | 內容 | 正式文件 |
| --- | --- | --- |
| G0～G3b（2026-09-30） | 三套機制（全域 RBAC、資料夾授權、擁有者規則）收斂成同一張關係圖；權限依賴樹；revision ＋ 平台 DB 廣播的失效；舊表刪除 | ADR-0024 D1～D9、`rbac/01-domain-model.md` §6.4、`rbac/02-permission-catalog.md` §9、`rbac/07-resource-grants.md` §2.1、`backend/02-database.md` §2.10、§2.11、`backend/05-rbac.md` §4.2、§5 |
| G4a（2026-10-01） | 群組（巢狀、持有角色、資料夾授權給群組）；反提權一般化（模型宣告能力、引擎算出取得的能力） | ADR-0024 D10～D13、D15、D16、`rbac/08-groups.md`、`backend/05-rbac.md` §4.1 |
| G4b（2026-10-01） | 「為什麼能做 X」：有效權限的來源、資料夾存取的路徑、依操作者遮蔽 | ADR-0024 D14、`rbac/09-explain.md` |

這份提案只剩下還沒做的部分。

## 背景

編輯器的資源會以專案為單位授權；專案應該是資料夾（與之後的關卡）的上層。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| `project` 型別，成為資料夾的上層 | 通用的 ListObjects（「列出我能讀的所有東西」） |
| 專案成員自動是底下資料夾與關卡的某個等級 | deny／排除（D4）、過期以外的條件式權限 |

## 使用者故事

**作為開發者，我希望新增「關卡」這種資源時只要宣告它的關係與能力，以便不用再寫一套解析、快取、反提權與說明。**

## 初步構想

`project` 型別，`fileFolder` 的 `inherits_from` 可以指向專案；專案成員（`project:P#member`）自動成為底下資料夾與關卡的某個等級。
模型上多一個型別、一條 `inherits_from` 的邊與它的能力宣告（`defineType(…, { capabilities })`），判斷器、反提權（`rbac/07-resource-grants.md` §10.1）
與說明（擁有者模組取路徑、以 resolver 補上自己的節點，`rbac/09-explain.md` §4）都會沿著走。
專案成員的管理大概會是第一個需要「下放」的地方（D16 的後續）：要做時先重新評估 D13（放進主體時不檢查它在資源上的授權）。

## 開放問題

G4 的問題已於 2026-10-01 結論，寫在 ADR-0024 D10～D16。

1. 專案成員對應到資料夾的哪個等級？是固定的，還是每個專案可以設定？
2. 專案成員能不能自己管成員（下放）？若可以，D13 要改成檢查專案在資源上的授權嗎？

## 歸檔去向

隨專案功能的提案一起歸檔：專案的型別與等級寫進 `rbac/07-resource-grants.md` 或新的 `rbac/` 章節；ADR-0024 加 G5 的實作紀錄；全部完成後刪除本檔。
