# ADR-0003 — ORM 採用 Drizzle 而非 Prisma

- 狀態：**提案中（待確認）**
- 日期：2026-09-19
- 相關：[`../architecture/backend/02-database.md`](../architecture/backend/02-database.md)

## 背景

使用者指定 Drizzle ORM。本 ADR 記錄為什麼這對 RBAC 專案是好選擇，
以及要注意的地方。

## 決定

採用 **Drizzle ORM** ＋ `drizzle-kit` ＋ `postgres-js` driver。

## 理由

1. **核心查詢是多表 join。** RBAC 最熱的查詢是
   「user → user_roles → role_permissions → permissions 的 distinct key 集合」。
   Drizzle 寫出來就是那個 SQL 的樣子；Prisma 的巢狀 `include` 會變成多次查詢，
   要一句 SQL 得用 `$queryRaw`（於是失去型別）。
2. **Schema 就是 TypeScript。** 沒有 `.prisma` DSL，沒有 `prisma generate`
   這個必須記得跑的步驟。型別從 schema 直接推導。
3. **DB 特有能力可直接表達。** partial unique index、`CHECK` 約束、
   `citext` 欄位、`json_agg` ——本專案的不變條件大量依賴這些。
   Prisma 的 schema DSL 表達不了 partial index，要靠手寫 migration ＋ 繞過
   schema 的真實狀態。
4. **無執行期額外負擔。** 純 JavaScript，沒有 Rust query engine binary，
   容器映像更小、冷啟動更快。

## 代價

| 代價                                                        | 緩解                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 沒有 Prisma Studio 那樣成熟的 GUI                           | `drizzle-kit studio` 夠用；複雜查詢直接 psql                                                          |
| Migration 產生不如 Prisma 聰明（欄位改名可能變成 drop+add） | **明定規則：產生後必須人工檢視 SQL**（[`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §5.1） |
| Trigger / function 要手寫 migration                         | 本來就要手寫；已在 §5.2 定義位置                                                                      |
| 關聯查詢需要自己想清楚 join                                 | 這是優點不是缺點——N+1 不會偷偷發生                                                                    |
| 生態系比 Prisma 小                                          | 核心功能穩定；NestJS 整合只需要一個 provider                                                          |

## 替代方案

| 方案                   | 不採用的理由                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| Prisma                 | 見上；另外 `@prisma/client` 的 binary 讓容器與冷啟動變重               |
| TypeORM                | NestJS 官方範例常用，但 decorator + 反射的型別安全弱，migration 體驗差 |
| Kysely                 | 查詢建構器很好，但沒有 schema/migration 管理，要另外配一套             |
| 純 SQL + `postgres-js` | 型別要自己維護，重構時沒有編譯期保護                                   |
