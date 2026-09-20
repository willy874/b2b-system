import type { UserStatus } from '@/shared/api-sdk';

export interface UserListParams {
  offset: number;
  limit: number;
  keyword?: string;
  status?: UserStatus[];
  roleId?: string[];
  sortBy?: 'createdAt' | 'email' | 'displayName' | 'lastLoginAt';
  sortOrder?: 'asc' | 'desc';
}
