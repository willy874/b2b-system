import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AuthzRegistry, AuthzService, AuthzShadow } from '@/core/authz';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { resolveHierarchyLevels } from '@/modules/resource-grant/resource-grant.resolver';
import { ResourceGrantService } from '@/modules/resource-grant/resource-grant.service';

import { FileAccessContext, FILE_ACTION_PERMISSION, FILE_ACTIONS } from './file-access.context';
import type { FileAction, FileLocation, FolderNode } from './file-access.context';
import { folderEdgeProvider, locationObject } from './file-access.snapshot';
import { FileFolderTree } from './file-folder-tree';
import { FILE_ACTION_RELATION, FILE_AUTHZ_TYPES } from './file.authz';

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
    private readonly grants: ResourceGrantService,
    private readonly tree: FileFolderTree,
    private readonly audit: AuditService,
    private readonly authz: AuthzService,
    private readonly shadow: AuthzShadow,
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
    const { permissions, isSuperAdmin } = await this.permissions.getPermissionSet(actor.id);
    const globalActions = new Set<FileAction>(
      FILE_ACTIONS.filter(
        (action) => isSuperAdmin || permissions.has(FILE_ACTION_PERMISSION[action]),
      ),
    );
    // 交易外讀快取；交易內（持有樹鎖）直接查
    const nodes = await this.tree.nodes(tx);
    // 過期的判斷在新舊兩套用同一個時間點
    const now = new Date();
    // 資料夾掛到專案底下之後，上層鏈多一種節點：這裡加上 'project'（ADR-0015 §延伸）
    const grants = await this.grants.grantsFor(actor.id, FILE_ACCESS_RESOURCE_TYPES, tx, now);
    const levelOf = resolveHierarchyLevels(nodes, grants);
    const folders = new Map(nodes.map((node) => [node.id, node]));
    const ctx = new FileAccessContext(actor.id, globalActions, folders, levelOf);
    if (this.shadow.enabled) await this.compareWithGraph(ctx, folders, now, tx);
    return ctx;
  }

  /**
   * G1 影子比對（docs/adr/0024-relationship-based-access-control.md）：以關係圖判斷同一位操作者，
   * 每個位置（所有資料夾 ＋ 根目錄）× 5 個動作，以及每個資料夾本身的改名／刪除，應與舊的解析一致。
   */
  private async compareWithGraph(
    ctx: FileAccessContext,
    folders: ReadonlyMap<string, FolderNode>,
    now: Date,
    tx?: DbOrTx,
  ): Promise<void> {
    const run = async (db: DbOrTx) => {
      const options = { withDependencies: false, tx: db, now };
      const tenant = await this.authz.tenantPermissions(ctx.actorId, options);
      const checker = await this.authz.checkerFor(
        tenant.subjects,
        FILE_ACCESS_RESOURCE_TYPES,
        [folderEdgeProvider(folders)],
        options,
      );
      const mismatches: string[] = [];
      for (const location of [null, ...folders.keys()]) {
        for (const action of FILE_ACTIONS) {
          const legacy = ctx.can(action, location);
          const engine = checker.check(locationObject(location), FILE_ACTION_RELATION[action]);
          if (legacy !== engine)
            mismatches.push(`${action}@${location ?? 'root'}：${legacy}≠${engine}`);
        }
      }
      for (const folder of folders.values()) {
        const object = locationObject(folder.id);
        const pairs = [
          ['rename', ctx.canModify('update', folder.parentId, folder.createdBy), 'can_rename'],
          ['remove', ctx.canModify('delete', folder.parentId, folder.createdBy), 'can_remove'],
        ] as const;
        for (const [label, legacy, relation] of pairs) {
          const engine = checker.check(object, relation);
          if (legacy !== engine) mismatches.push(`${label}(${folder.id})：${legacy}≠${engine}`);
        }
      }
      this.shadow.report(
        'fileAccess',
        mismatches.length ? { actorId: ctx.actorId, mismatches } : null,
      );
    };
    // 在呼叫端的交易裡（持有樹鎖）就沿用它；否則開一個一致讀取的交易
    await (tx ? run(tx) : this.authz.readConsistently(run));
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
