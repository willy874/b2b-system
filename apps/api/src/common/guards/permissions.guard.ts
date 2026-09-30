import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';

import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import {
  IS_AUTHENTICATED,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  REQUIRED_PLATFORM_PERMISSIONS,
} from '../decorators';
import type { PermissionRequirement, PlatformPermissionRequirement } from '../decorators';
import { getSocketIdentity } from '../types';
import type { AuthenticatedRequest, WsClient } from '../types';

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
    private readonly platformAdmins: PlatformAdminService,
    private readonly platformAudit: PlatformAuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const type = ctx.getType<'http' | 'ws'>();
    if (type !== 'http' && type !== 'ws') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;

    const { route, user } = type === 'ws' ? this.wsSubject(ctx) : this.httpSubject(ctx);
    const platformRequirement = this.reflector.getAllAndOverride<PlatformPermissionRequirement>(
      REQUIRED_PLATFORM_PERMISSIONS,
      targets,
    );
    if (platformRequirement) return this.checkPlatform(type, route, user, platformRequirement);
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

  /**
   * 平台管理者的端點（docs/adr/0020-physical-tenant-isolation.md D5）：只在不屬於任何租戶的網域有效，
   * 權限來自平台管理者的角色。拒絕寫平台稽核（租戶的稽核看不到平台的事）。
   */
  private async checkPlatform(
    type: 'http' | 'ws',
    route: string,
    user: GuardSubject['user'],
    { keys }: PlatformPermissionRequirement,
  ): Promise<true> {
    if (type !== 'http' || currentTenant()) throw new AppException('PLATFORM_ONLY');
    // JwtAuthGuard 在沒有租戶的網域只接受平台管理者的 token
    if (!user) throw new AppException('AUTH_TOKEN_INVALID');
    const permissions = await this.platformAdmins.permissionsOf(user.id);
    const missing = keys.filter((key) => !permissions.has(key));
    if (!missing.length) return true;
    await this.platformAudit.recordSafely({
      action: 'authz.denied',
      resourceType: 'authz',
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: { route, required: keys, missing },
    });
    throw new AppException('AUTHZ_FORBIDDEN', { required: keys, missing });
  }

  private httpSubject(ctx: ExecutionContext): GuardSubject {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return { route: `${req.method} ${req.route?.path ?? req.path}`, user: req.user };
  }

  /** WebSocket：身分來自 handshake 寫進 `socket.data` 的資料（docs/architecture/backend/08-realtime.md §4）。 */
  private wsSubject(ctx: ExecutionContext): GuardSubject {
    const socket = ctx.switchToWs().getClient<WsClient>();
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
