import type { Request } from 'express';

import type { UserStatus } from '@/db/schema/users';

export interface AuthUser {
  id: string;
  email: string;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
