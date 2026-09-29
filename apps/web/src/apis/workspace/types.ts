import type { SortEntry } from '@/shared/constants';

/** 後端 `ListWorkspaceSchema` 的排序白名單。 */
export type WorkspaceSortField = 'createdAt' | 'name' | 'slug';

export interface WorkspaceListParams {
  offset: number;
  limit: number;
  keyword?: string;
  sort?: Array<SortEntry<WorkspaceSortField>>;
}

/** 後端 `ListWorkspaceMemberSchema` 的排序白名單。 */
export type WorkspaceMemberSortField = 'joinedAt' | 'email' | 'displayName';

export interface WorkspaceMemberListParams {
  workspaceId: string;
  offset: number;
  limit: number;
  keyword?: string;
  roleId?: string;
  sort?: Array<SortEntry<WorkspaceMemberSortField>>;
}
