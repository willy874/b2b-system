/** 部門樹的層數上限（最上層算第 1 層；docs/architecture/backend/23-organization.md §2）。 */
export const ORG_UNIT_MAX_DEPTH = 10;

/** 一次增減、修改成員的上限（DTO 的陣列上限）。 */
export const ORG_UNIT_MEMBER_BATCH_LIMIT = 200;

/** `PATCH /org-units/:id` 稽核的欄位。 */
export const ORG_UNIT_AUDIT_FIELDS = ['name', 'code', 'description'] as const;
