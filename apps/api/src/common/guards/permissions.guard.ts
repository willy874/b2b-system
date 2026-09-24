import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';
import type { Socket } from 'socket.io';

import { AppException } from '@/core/errors';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../decorators';
import type { PermissionRequirement } from '../decorators';
import { getSocketIdentity } from '../types';
import type { AuthenticatedRequest } from '../types';

interface GuardSubject {
  route: string;
  user?: { id: string; email: string };
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const type = ctx.getType<'http' | 'ws'>();
    if (type !== 'http' && type !== 'ws') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;

    const { route, user } = type === 'ws' ? this.wsSubject(ctx) : this.httpSubject(ctx);
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSIONS,
      targets,
    );

    // ★ 預設拒絕：沒有任何宣告 = 程式錯誤，不是「公開」
    if (!requirement) {
      throw this.reject(type, 'ROUTE_PERMISSION_NOT_DECLARED', { route });
    }

    if (!user) throw this.reject(type, 'AUTH_TOKEN_INVALID');

    const { keys, match } = requirement;
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(user.id);

    if (isSuperAdmin) return true;

    const granted =
      match === 'every'
        ? keys.every((key) => permissions.has(key))
        : keys.some((key) => permissions.has(key));

    if (!granted) {
      const missing = keys.filter((key) => !permissions.has(key));
      await this.audit.recordSafely({
        action: 'authz.denied',
        result: 'failure',
        actorId: user.id,
        actorEmail: user.email,
        resourceType: 'authz',
        errorCode: 'AUTHZ_FORBIDDEN',
        metadata: { route, required: keys, missing },
      });
      throw this.reject(type, 'AUTHZ_FORBIDDEN', { required: keys, missing });
    }

    return true;
  }

  private httpSubject(ctx: ExecutionContext): GuardSubject {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return { route: `${req.method} ${req.route?.path ?? req.path}`, user: req.user };
  }

  /** WebSocket：身分來自 handshake 寫進 `socket.data` 的資料（docs/architecture/backend/08-realtime.md §4）。 */
  private wsSubject(ctx: ExecutionContext): GuardSubject {
    const socket = ctx.switchToWs().getClient<Socket>();
    const event = Reflect.getMetadata(MESSAGE_METADATA, ctx.getHandler()) as unknown;
    const identity = getSocketIdentity(socket);
    return {
      route: `WS ${typeof event === 'string' ? event : ctx.getHandler().name}`,
      user: identity && { id: identity.userId, email: identity.email },
    };
  }

  /** HTTP 走 AppException → HttpExceptionFilter；ws 沒有全域 filter，改用 WsException 讓客戶端收到 code。 */
  private reject(
    type: 'http' | 'ws',
    code: 'ROUTE_PERMISSION_NOT_DECLARED' | 'AUTH_TOKEN_INVALID' | 'AUTHZ_FORBIDDEN',
    details?: Record<string, unknown>,
  ): Error {
    return type === 'ws' ? new WsException({ code, details }) : new AppException(code, details);
  }
}
