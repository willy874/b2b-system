import { Injectable } from '@nestjs/common';

import type { AuthUser, WorkspaceScope } from '@/common/types';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { resolveHierarchyLevels } from '@/modules/resource-grant/resource-grant.resolver';
import { ResourceGrantService } from '@/modules/resource-grant/resource-grant.service';

import { FileAccessContext, FILE_ACTION_PERMISSION, FILE_ACTIONS } from './file-access.context';
import type { FileAction, FileLocation } from './file-access.context';
import { FileFolderRepository } from './file-folder.repository';

/** 檔案的上層鏈上會出現的資源種類。 */
const FILE_ACCESS_RESOURCE_TYPES = ['fileFolder'] as const;

/**
 * 檔案管理器的資料夾層級授權（docs/rbac/07-resource-grants.md；docs/architecture/backend/09-file.md §11）。
 *
 * Guard 只當閘門（`file:access` 或全域 `file:<動作>`），範圍在這裡判斷——Guard 看不到資源
 * （docs/architecture/backend/05-rbac.md §1 原則 3 的例外）。資料夾授權不進權限快取：
 * 每個請求載入一次整棵資料夾結構與操作者的授權，在記憶體解析。
 */
@Injectable()
export class FileAccessService {
  constructor(
    private readonly permissions: PermissionService,
    private readonly grants: ResourceGrantService,
    private readonly folders: FileFolderRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * 建立操作者這次請求在這個工作區的存取判斷。結構寫入（移動、刪除）要在取得樹鎖的交易內呼叫並傳入 `tx`，
   * 檢查與寫入之間結構才不會變。同一個交易的查詢依序執行。
   * 全域動作看 `P(u, W)`：工作區內的 `file:*` 是「這個工作區的所有資料夾」（docs/adr/0018-workspace-tenancy.md D7）。
   */
  async contextFor(ws: WorkspaceScope, actor: AuthUser, tx?: DbOrTx): Promise<FileAccessContext> {
    const { permissions, isSuperAdmin } = await this.permissions.getWorkspacePermissionSet(
      actor.id,
      ws.workspaceId,
    );
    const globalActions = new Set<FileAction>(
      FILE_ACTIONS.filter(
        (action) => isSuperAdmin || permissions.has(FILE_ACTION_PERMISSION[action]),
      ),
    );
    const nodes = await this.folders.listTreeNodes(ws, tx);
    const grants = await this.grants.grantsFor(
      actor.id,
      FILE_ACCESS_RESOURCE_TYPES,
      ws.workspaceId,
      tx,
    );
    const levelOf = resolveHierarchyLevels(nodes, grants);
    return new FileAccessContext(
      actor.id,
      globalActions,
      new Map(nodes.map((node) => [node.id, node])),
      levelOf,
    );
  }

  /**
   * 在 `location` 做 `action` 的前提：資料夾不存在 → `404 FILE_FOLDER_NOT_FOUND`；
   * 不能做（含鎖住的資料夾）→ `403 AUTHZ_FORBIDDEN`（寫 `authz.denied`）。
   * 資料夾對所有能進檔案管理器的人可見（docs/rbac/07-resource-grants.md §5.1），所以不以 404 隱藏。
   */
  async assertCan(
    ctx: FileAccessContext,
    actor: AuthUser,
    action: FileAction,
    location: FileLocation,
  ): Promise<void> {
    if (location !== null && !ctx.exists(location)) {
      throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId: location });
    }
    if (!ctx.can(action, location)) {
      throw await this.deny(actor, action, 'fileFolder', location);
    }
  }

  /**
   * 資源層級的拒絕：與 Guard 的拒絕一樣寫 `authz.denied`（§6.4），回傳要拋出的例外。
   * 稽核不跟著呼叫端的交易：交易 rollback 時拒絕紀錄仍要留下。
   */
  async deny(
    actor: AuthUser,
    action: FileAction,
    resourceType: 'file' | 'fileFolder',
    resourceId: string | null,
    reason?: string,
  ): Promise<AppException> {
    const details = { action, resourceType, resourceId, ...(reason ? { reason } : {}) };
    await this.audit.recordSafely({
      action: 'authz.denied',
      result: 'failure',
      actorId: actor.id,
      actorEmail: actor.email,
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: details,
    });
    return new AppException('AUTHZ_FORBIDDEN', details);
  }
}
