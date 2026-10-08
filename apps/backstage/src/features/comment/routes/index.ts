// 留言與關注沒有自己的頁面：面板掛在擁有資源的頁面上（`core/resource-panel`，docs/architecture/frontend/22-comment.md §2）。
// 照 feature 的形狀仍匯出 `Routes`（docs/architecture/frontend/03-feature-anatomy.md §2.1），內容是空的。
// oxlint-disable-next-line unicorn/require-module-specifiers -- 沒有 route 可匯出，但要是一個模組才能 `import * as Routes`
export {};
