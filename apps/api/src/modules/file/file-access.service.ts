import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AuthzRegistry, AuthzService, impliedRelations } from '@/core/authz';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { FileAccessContext, FILE_ACTION_RELATION, FILE_ACTIONS } from './file-access.context';
import type { FileAction, FileLocation } from './file-access.context';
import { folderEdgeProvider } from './file-access.snapshot';
import { FileFolderTree } from './file-folder-tree';
import { GRANT_LEVELS } from './file-grant.levels';
import type { GrantLevel, LevelActions } from './file-grant.levels';
import { FILE_AUTHZ_TYPES } from './file.authz';

/** 檔案的上層鏈上會出現的資源種類。 */
const FILE_ACCESS_RESOURCE_TYPES = ['fileFolder'] as const;

/**
 * 檔案管理器的資料夾層級授權（docs/rbac/07-resource-grants.md；docs/architecture/backend/09-file.md §11）。
 *
 * Guard 只當閘門（`file:access` 或全域 `file:<動作>`），範圍在這裡判斷——Guard 看不到資源
 * （docs/architecture/backend/05-rbac.md §1 原則 3 的例外）。資料夾授權不進權限快取：
 * 每個請求取一次整棵資料夾結構（程序內快取，`FileFolderTree`）與操作者的授權，在記憶體解析。
 */
@Injectable()
export class FileAccessService implements OnModuleInit {
  constructor(
    private readonly permissions: PermissionService,
    private readonly tree: FileFolderTree,
    private readonly audit: AuditService,
    private readonly authz: AuthzService,
    private readonly registry: AuthzRegistry,
  ) {}

  /** 檔案管理器的型別註冊進關係圖（core 不認識業務型別）。 */
  onModuleInit(): void {
    for (const definition of FILE_AUTHZ_TYPES) this.registry.register(definition);
  }

  /**
   * 建立操作者這次請求的存取判斷。結構寫入（移動、刪除）要在取得樹鎖的交易內呼叫並傳入 `tx`，
   * 檢查與寫入之間結構才不會變。同一個交易的查詢依序執行。
   */
  async contextFor(actor: AuthUser, tx?: DbOrTx): Promise<FileAccessContext> {
    const set = await this.permissions.getPermissionSet(actor.id);
    // 交易外讀快取；交易內（持有樹鎖）直接查
    const nodes = await this.tree.nodes(tx);
    const folders = new Map(nodes.map((node) => [node.id, node]));
    const options = { withDependencies: true, tx };
    const subjects =
      set.subjects ?? (await this.authz.tenantPermissions(actor.id, options)).subjects;
    // 資料夾掛到專案底下之後，上層鏈多一種節點：這裡加上 'project'（ADR-0015 §延伸）
    const checker = await this.authz.checkerFor(
      subjects,
      FILE_ACCESS_RESOURCE_TYPES,
      [folderEdgeProvider(folders)],
      options,
    );
    return new FileAccessContext(actor.id, folders, checker, this.levelActions());
  }

  /** 每個等級蘊含的動作：由模型的靜態蘊含算出（取代寫死的對照表）。 */
  private levelActions(): LevelActions<FileAction> {
    const model = this.registry.model(true);
    const actionsOf = (level: GrantLevel) => {
      const implied = impliedRelations(model, 'fileFolder', level);
      return FILE_ACTIONS.filter((action) => implied.has(FILE_ACTION_RELATION[action]));
    };
    return Object.fromEntries(GRANT_LEVELS.map((level) => [level, actionsOf(level)])) as Record<
      GrantLevel,
      FileAction[]
    >;
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
