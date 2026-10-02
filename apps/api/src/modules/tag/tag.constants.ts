/** 一個標籤組最多幾個標籤（docs/architecture/backend/18-tag.md §7.2 D11）：管理頁與篩選選單一次列完，不分頁。 */
export const TAG_MAX_PER_SCOPE = 200;

/** 一個資源最多貼幾個標籤（D11）。 */
export const TAG_MAX_PER_RESOURCE = 20;

export const TAG_NAME_MAX_LENGTH = 50;

/** 名稱唯一索引（`db/schema/tags.ts`）：撞到時轉成 `TAG_NAME_DUPLICATE`。 */
export const TAG_NAME_UNIQUE_CONSTRAINT = 'tags_scope_name_unique';
