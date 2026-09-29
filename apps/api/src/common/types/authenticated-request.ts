import type { Request } from 'express';

import type { UserStatus } from '@/db/schema/users';

import type { WorkspaceScope } from './workspace-scope';

export interface AuthUser {
  id: string;
  email: string;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  /** `@WorkspaceScoped()` 路由：guard 確認成員資格後寫入。 */
  workspace?: WorkspaceScope;
}
