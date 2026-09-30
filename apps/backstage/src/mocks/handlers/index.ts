import { authHandlers } from './auth';
import { notificationHandlers } from './notification';
import { rbacHandlers } from './rbac';

export const handlers = [...authHandlers, ...rbacHandlers, ...notificationHandlers];
