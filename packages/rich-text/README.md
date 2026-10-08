# @b2b-system/rich-text

富文本的 **格式定義與轉換**，api 與前端（經由 `@b2b-system/ui` 的 `RichTextEditor`／`RichTextViewer`）共用同一份規則。
規格與設計決策見 [`docs/architecture/frontend/07-ui-system.md`](../../docs/architecture/frontend/07-ui-system.md) §3.16、§14；第一個使用者是公告的內文（[`docs/architecture/backend/19-announcement.md`](../../docs/architecture/backend/19-announcement.md) §9.2 D21、D22）。

文件格式是 ProseMirror 的文件 JSON（Tiptap 的 `editor.getJSON()`），**這是唯一存進資料庫的格式**；HTML 與純文字都由它產生。

| 子路徑 | 內容 | 依賴 |
| --- | --- | --- |
| `@b2b-system/rich-text` | 型別（`RichTextDocument`…）、`RICH_TEXT_FORMATS`、內容規則 `findRichTextIssue`／`isValidRichTextDocument`、`richTextToPlainText`、`isRichTextEmpty`、`plainTextToRichText`、`isSafeLinkHref`、`normalizeLinkHref`、`richTextToHtml` | 無 |
| `@b2b-system/rich-text/schema` | zod：`RichTextNodeSchema`、`RichTextDocumentShapeSchema`、`createRichTextDocumentSchema({ maxLength, required, maxDepth, maxNodes })` | `zod` |
| `@b2b-system/rich-text/html` | `htmlToRichText(html)`：外部送來的 HTML 轉成文件，只留白名單內的格式 | `htmlparser2` |

```ts
import { richTextToHtml, richTextToPlainText } from '@b2b-system/rich-text';
import { createRichTextDocumentSchema } from '@b2b-system/rich-text/schema'; // api 的 DTO（經由 `core/validation` 的 `richTextInput`）
import { htmlToRichText } from '@b2b-system/rich-text/html';
```

## 規則

- 不依賴 DOM 或 Node 專屬的 API：api（Node）與瀏覽器都會載入。`sideEffects: false`；主入口零依賴，zod 與 HTML 解析器只在各自的子路徑，前端不會帶進來。
- app 不直接依賴這個 package：前端經由 `@b2b-system/ui/RichTextViewer` 轉出的型別與函式（[`docs/coding-standards/07-layer-dependencies.md`](../../docs/coding-standards/07-layer-dependencies.md) §1）。
- 要 **build** 到 `dist/`（api 在執行期讀它）：`pnpm build:packages`（`pnpm dev` 會先跑）。相對 import 要寫 `.js`（`from './link.js'`）：Node 直接載入 `dist/` 的 ESM，不會補副檔名（與 `@b2b-system/realtime` 相同；測試由 vitest 解析，抓不到這個錯）。
- **新增格式**時同一批修改：`document.ts` 的清單、`validate.ts` 的內容規則、`to-html.ts`、`html.ts`、`packages/ui` 的編輯器 extension 與 `RichTextViewer`、`07-ui-system.md` §3.16 的表。
- 安全：連結一律經過 `isSafeLinkHref`（輸入、貼上、驗證、轉 HTML、顯示）；`richTextToHtml` 跳脫所有文字與屬性；`htmlToRichText` 丟掉 `<script>`、`<style>` 等元素連同內容、不保留任何屬性（`href` 以外）。

```bash
pnpm --filter @b2b-system/rich-text build
pnpm --filter @b2b-system/rich-text test
```
