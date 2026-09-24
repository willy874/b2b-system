# ADR-0001 — 前端採用 Plugin-based AppContext

- 狀態：**提案中（待確認）**
- 日期：2026-09-19
- 相關：[`../architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md)

## 背景

前端需要一個機制，決定「一個功能如何接進整個 app」。典型的 React app 會讓
`App.tsx` 認識所有 provider、`routes.tsx` 認識所有頁面、`i18n.ts` 認識所有語系
包、`menu.ts` 認識所有選單項。新增一個功能要改五個核心檔案；刪除一個功能要記得
五個地方，漏掉的會變成死碼。

## 決定

採用 plugin-based AppContext：

```ts
createAppContext()
  .use(cachePlugin())
  .use(i18nPlugin())
  .use(roleFeaturePlugin())
  .use(appContextPlugin())
  .load();
```

- Plugin factory 在 `use()` 時 **同步** 執行，回傳 `{ name, attrs, onInit, onDestroy }`
- `attrs` 透過 TypeScript declaration merging 擴充 `AppPluginProperties`，
  核心不需要認識任何 plugin 的型別
- 需要 I/O 的初始化放 `onInit`，由 `load()` 依序 await
- 各種註冊表（權限、偏好、元件）在同步階段被寫入

## 理由

1. **增刪一個功能 = 增刪一行。** 註解掉 `.use(roleFeaturePlugin())`，角色功能的
   路由、語系、權限、選單全部一起消失，不留殘骸。
2. **核心不認識功能。** `core/permission/registry.ts` 沒有列舉頁面的靜態表，
   每個 feature 註冊自己的。新增 feature 不需要改 `core/` 任何一行。
3. **功能可以擴充功能。** `plugins/features/*` 讓 A 功能往 B 功能的註冊表插東西，
   B 完全不知道 A 存在。偏好頁的分頁就是這樣做的。
4. **已驗證。** 這套機制已在一個承載 14 個 feature 的管理後台上實際運行過。

## 代價

| 代價                                                                | 緩解                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 比直接 import 多一層間接，新人需要時間理解                          | [`../architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) 與 [`../architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) 的 SOP |
| 失去「靜態表的編譯期完整性」                                        | 用 `registry.test.ts` 斷言註冊鍵集合 = feature page key 聯集                                                                                      |
| `use()` 同步 / `load()` 非同步的分野需要記住                        | 文件明確標示；權限註冊必須在同步階段（否則首次 render 會炸）                                                                                      |
| 註冊順序有隱含相依（`httpContextPlugin` 必須在 `cachePlugin` 之後） | `main.tsx` 加註解說明；未來可加宣告式相依檢查                                                                                                     |

## 替代方案

| 方案                               | 不採用的理由                                                     |
| ---------------------------------- | ---------------------------------------------------------------- |
| 直接 import ＋ 集中式註冊表        | 就是要避免的那個問題                                             |
| Module Federation                  | 為跨部署的微前端設計，這裡是單一部署，複雜度不成比例             |
| Nx / Turborepo 的 library boundary | 只管相依方向，不解決「功能如何自我註冊」                         |
| React Context 疊套                 | 巢狀地獄；無法表達非 render 期的註冊（權限必須在 render 前完成） |
