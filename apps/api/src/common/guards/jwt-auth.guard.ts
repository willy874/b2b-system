import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '@/core/errors';
import { setContextUser } from '@/core/http';
import { currentTenant } from '@/core/tenant';

import { AccessTokenVerifier } from '../auth/access-token.verifier';
import { IS_PUBLIC, REQUIRED_PLATFORM_PERMISSIONS } from '../decorators';
import type { AuthenticatedRequest } from '../types';

export type { AccessTokenPayload } from '../auth/access-token.verifier';

export function extractBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token.length ? token : undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSocket 由 handshake middleware 與 WsAuthGuard 把關（docs/architecture/backend/08-realtime.md §4）
    if (ctx.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }

    // 平台管理者的端點在租戶網域上等同不存在（docs/architecture/05-tenancy.md §10.2 D5），不必先驗 token
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (
      currentTenant() &&
      this.reflector.getAllAndOverride(REQUIRED_PLATFORM_PERMISSIONS, targets)
    ) {
      throw new AppException('PLATFORM_ONLY');
    }

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const result = await this.verifier.verify(extractBearer(req.headers.authorization));
    if (!result.ok) throw new AppException(result.code);

    const { user } = result;
    req.user = { id: user.id, email: user.email, status: user.status };
    setContextUser({ id: user.id, email: user.email });
    return true;
  }
}
