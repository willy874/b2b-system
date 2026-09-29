import { applyDecorators, createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';

import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';

import type { AuthenticatedRequest, WorkspaceScope } from '../types';

export const IS_WORKSPACE_SCOPED = 'rbac:isWorkspaceScoped';

/** 工作區範圍的路由參數名稱：`@Controller('workspaces/:workspaceId/…')`。 */
export const WORKSPACE_ID_PARAM = 'workspaceId';

/**
 * 工作區範圍的 controller（docs/adr/0018-workspace-tenancy.md D8、D9）：路徑帶 `:workspaceId`，
 * guard 先確認成員資格（不是成員回 404），權限鍵以操作者在該工作區的集合判斷。
 * 宣告的權限鍵必須是 workspace 範圍（`route-audit` 在啟動時檢查）。
 */
export const WorkspaceScoped = () =>
  applyDecorators(
    SetMetadata(IS_WORKSPACE_SCOPED, true),
    // handler 從 `@CurrentWorkspace()` 取得範圍、不宣告 `@Param`：在這裡補上 OpenAPI 的 path 參數
    ApiParam({ name: WORKSPACE_ID_PARAM, format: 'uuid' }),
  );

/** guard 寫入的工作區範圍；只能用在 `@WorkspaceScoped()` 的 controller。 */
export const CurrentWorkspace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceScope => {
    const { workspace } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!workspace) {
      // 只可能發生在沒有標 @WorkspaceScoped 的 controller 取用 → 程式錯誤
      throw new AppException(
        'INTERNAL_ERROR' satisfies ErrorCode,
        undefined,
        '@CurrentWorkspace used outside a @WorkspaceScoped controller',
      );
    }
    return workspace;
  },
);
