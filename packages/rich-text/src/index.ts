/*
 * 富文本的格式定義與轉換（docs/architecture/frontend/07-ui-system.md §3.16）：api 與前端（經由 `@b2b-system/ui`）共用。
 * 主入口零依賴；zod schema 在 `@b2b-system/rich-text/schema`、HTML → 文件在 `@b2b-system/rich-text/html`。
 */
export * from './document.js';
export * from './link.js';
export * from './plain-text.js';
export * from './to-html.js';
export * from './validate.js';
