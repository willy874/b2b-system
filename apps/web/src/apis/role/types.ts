export interface RoleListParams {
  offset: number;
  limit: number;
  keyword?: string;
  isSystem?: boolean;
  sortBy?: 'createdAt' | 'name' | 'slug';
  sortOrder?: 'asc' | 'desc';
}
