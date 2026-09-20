import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { AppException, ErrorCode } from '@/core/errors';

import type { AuthenticatedRequest, AuthUser } from '../types';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!user) {
    // 只可能發生在標了 @Public 又取用 @CurrentUser 的 handler → 程式錯誤
    throw new AppException(
      'INTERNAL_ERROR' satisfies ErrorCode,
      undefined,
      '@CurrentUser used on an unauthenticated route',
    );
  }
  return user;
});
