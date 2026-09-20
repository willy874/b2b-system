import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'rbac:isPublic';

/** 不需登入即可存取。 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
