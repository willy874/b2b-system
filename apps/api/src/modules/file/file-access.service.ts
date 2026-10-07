import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AuthzRegistry, AuthzService, capabilitiesOf } from '@/core/authz';
import type { PermissionSet } from '@/core/cache';
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
 * 檔案管理器的資料夾層級授權（docs/architecture/iam/06-resource-grants.md；docs/architecture/backend/09-file.md §11）。
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
   * 操作者的權限集合：結構寫入要在進樹鎖的交易 **之前** 取好，再交給 `contextFor(actor, tx, permissions)`。
   * 權限集合不在樹鎖保護的範圍內，提前讀與 guard 的判斷一致。
   */
  permissionsOf(actor: Pick<AuthUser, 'id'>): Promise<PermissionSet> {
    return this.permissions.getPermissionSet(actor.id);
  }

  /**
   * 建立操作者這次請求的存取判斷（`actor` 只用到 id：說明別人的存取時（G4b）以目標使用者建立）。
   *
   * 結構寫入（建立、移動、刪除、授權）要在取得樹鎖的交易內呼叫並傳入 `tx`，檢查與寫入之間結構才不會變；
   * 這時一定要同時傳入交易前取好的 `permissions`（`permissionsOf`）：權限快取沒命中時，`getPermissionSet` 會從連線池另取一條連線，
   * 而持有樹鎖的交易已經佔著一條、等鎖的交易也各佔一條——池子滿了就互相等到 `statement_timeout`
   * （docs/architecture/backend/09-file.md §11.1）。同一個交易的查詢依序執行。
   */
  async contextFor(
    actor: Pick<AuthUser, 'id'>,
    tx?: DbOrTx,
    permissions?: PermissionSet,
  ): Promise<FileAccessContext> {
    if (tx && !permissions) {
      throw new Error(
        '在交易內建立存取判斷要傳入交易前取好的權限集合（FileAccessService.permissionsOf）',
      );
    }
    const set = permissions ?? (await this.permissions.getPermissionSet(actor.id));
    // 交易外讀快取；交易內（持有樹鎖）直接查
    const nodes = await this.tree.nodes(tx);
    const folders = new Map(nodes.map((node) => [node.id, node]));
    const options = { withDependencies: true, tx };
    const subjects =
      set.subjects ?? (await this.authz.tenantPermissions(actor.id, options)).subjects;
    // 對外 API 限縮過的 token：租戶層只認 token 的權限，資料夾上的授權照舊（docs/architecture/06-external-api.md §9.2 D3）
    const tenantOverride = set.tokenScoped ? { relations: set.permissions } : undefined;
    const checker = await this.authz.checkerFor(
      subjects,
      FILE_ACCESS_RESOURCE_TYPES,
      [folderEdgeProvider(folders)],
      options,
      tenantOverride,
    );
    return new FileAccessContext(actor.id, folders, checker, this.levelActions());
  }

  /**
   * 每個等級帶來的動作：模型宣告的能力（`can_*`）中，等級靜態蘊含的那些——與群組、角色的反提權是同一個定義
   * （`capabilitiesOf`，docs/architecture/iam/01-model.md §9 G4）。
   */
  private levelActions(): LevelActions<FileAction> {
    const model = this.registry.model(true);
    const actionsOf = (level: GrantLevel) => {
      const granted = new Set(capabilitiesOf(model, 'fileFolder', level));
      return FILE_ACTIONS.filter((action) => granted.has(FILE_ACTION_RELATION[action]));
    };
    return Object.fromEntries(GRANT_LEVELS.map((level) => [level, actionsOf(level)])) as Record<
      GrantLevel,
      FileAction[]
    >;
  }

  /**
   * 在 `location` 做 `action` 的前提：資料夾不存在 → `404 FILE_FOLDER_NOT_FOUND`；
   * 不能做（含鎖住的資料夾）→ `403 AUTHZ_FORBIDDEN`（寫 `authz.denied`）。
   * 資料夾對所有能進檔案管理器的人可見（docs/architecture/iam/06-resource-grants.md §5.1），所以不以 404 隱藏。
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
