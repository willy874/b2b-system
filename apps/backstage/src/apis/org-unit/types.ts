/** `GET /org-units/:id/members` 的參數（docs/architecture/backend/23-organization.md §5）。 */
export interface OrgUnitMemberListParams {
  unitId: string;
  offset: number;
  limit: number;
  includeDescendants?: boolean;
  keyword?: string;
}
