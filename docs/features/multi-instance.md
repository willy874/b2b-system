# 多實例部署

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 6、7 項、[`job-queue.md`](./job-queue.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

api 目前假設只有一個程序：

- 權限快取、使用者快取在程序記憶體，失效只作用在本程序
- Socket.io 的 room 只在本程序，推播到不了連在其他實例的使用者
- 速率限制的計數在程序記憶體

水平擴展之前，這三件事都要改成共享的。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 快取失效跨實例廣播 | 跨區域部署 |
| Socket.io adapter 跨實例 | |
| 速率限制共享計數 | |
| 稽核日誌分區表（roadmap 第 6 項；目前是熱表／冷表兩張） | |

## 初步構想

- 方案 A：引入 Redis（快取、Socket.io adapter、throttler storage 都有現成套件）
- 方案 B：先用 Postgres `LISTEN/NOTIFY` 廣播失效與推播，不增加元件

## 開放問題

1. Redis 或 Postgres？與 [`job-queue.md`](./job-queue.md) 的選擇一起決定
2. 稽核日誌分區要現在做，還是等熱表真的撐不住？

## 歸檔去向

- `docs/adr/NNNN-multi-instance.md`、`docs/architecture/01-system.md` 部署拓撲
