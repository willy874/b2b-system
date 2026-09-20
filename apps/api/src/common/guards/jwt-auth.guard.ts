import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';

import { UserCacheService } from '@/core/cache';
import type { Env } from '@/core/config';
import { DRIZZLE } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { setContextUser } from '@/core/http';
import { users } from '@/db/schema';

import { IS_PUBLIC } from '../decorators';
import type { AuthenticatedRequest } from '../types';

export interface AccessTokenPayload {
  sub: string;
  ver: number;
  jti: string;
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token.length ? token : undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly userCache: UserCacheService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new AppException('AUTH_TOKEN_INVALID');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_SECRET', { infer: true }),
      });
    } catch {
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    const user = (await this.userCache.get(payload.sub)) ?? (await this.loadUser(payload.sub));
    if (!user || user.deletedAt) throw new AppException('AUTH_TOKEN_INVALID');
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');
    if (user.tokenVersion !== payload.ver) throw new AppException('AUTH_TOKEN_STALE');

    req.user = { id: user.id, email: user.email, status: user.status };
    setContextUser({ id: user.id, email: user.email });
    return true;
  }

  private async loadUser(userId: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        tokenVersion: users.tokenVersion,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(and(eq(users.id, userId)))
      .limit(1);
    if (!row) return undefined;
    this.userCache.set(row);
    return row;
  }
}
