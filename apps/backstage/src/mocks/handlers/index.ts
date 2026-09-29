import { authHandlers } from './auth';
import { rbacHandlers } from './rbac';

export const handlers = [...authHandlers, ...rbacHandlers];
