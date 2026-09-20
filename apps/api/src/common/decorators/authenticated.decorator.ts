import { SetMetadata } from '@nestjs/common';

export const IS_AUTHENTICATED = 'rbac:isAuthenticated';

/** 只要登入即可，不需要特定權限。用於「對象是自己」的端點。 */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);
