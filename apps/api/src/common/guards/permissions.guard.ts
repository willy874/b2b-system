import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppException } from '@/core/errors';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../decorators';
import type { PermissionRequirement } from '../decorators';
import type { AuthenticatedRequest } from '../types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSIONS,
      targets,
    );

    // ★ 預設拒絕：沒有任何宣告 = 程式錯誤，不是「公開」
    if (!requirement) {
      throw new AppException('ROUTE_PERMISSION_NOT_DECLARED', { route });
    }

    const user = req.user;
    if (!user) throw new AppException('AUTH_TOKEN_INVALID');

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
      throw new AppException('AUTHZ_FORBIDDEN', { required: keys, missing });
    }

    return true;
  }
}
