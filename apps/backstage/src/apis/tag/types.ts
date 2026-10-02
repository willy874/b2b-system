/** 標籤組（後端由擁有者模組登記，docs/adr/0032-tags.md D1）：檔案管理器（檔案與資料夾）、使用者。 */
export type TagScope = 'file' | 'user';

/** 可以貼標籤的資源類型（`resource_tags.resource_type`）。 */
export type TaggableResourceType = 'file' | 'fileFolder' | 'user';
