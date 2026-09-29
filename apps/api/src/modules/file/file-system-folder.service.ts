import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import type { ResourceChangeWire } from '@game-editor/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PERMISSION, workspaceScopeOf } from '@/common/types';
import type { WorkspaceScope } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import type { FileFolderRow } from '@/db/schema';
import { EVERYONE_SUBJECT_ID } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { ResourceGrantService } from '@/modules/resource-grant/resource-grant.service';

import { FileFolderRepository } from './file-folder.repository';

/** 系統資料夾的名稱（建立時；之後不能改名）。 */
export const SHARED_FOLDER_NAME = '共用資料夾';
export const PRIVATE_ROOT_FOLDER_NAME = '私人資料夾';

/**
 * 系統資料夾（docs/rbac/07-resource-grants.md §12），每個工作區一套（docs/adr/0018-workspace-tenancy.md D7）：
 * - 共用資料夾：所有人（`everyone`）是 editor；
 * - 私人資料夾：容器，沒有授權；底下每個能進檔案管理器的成員一個個人資料夾（本人 manager、不繼承上層）。
 *
 * 啟動時逐一確保每個工作區的共用／私人資料夾存在並補建個人資料夾（冪等）；之後訂閱
 * `permissions.changed`，在某個工作區取得檔案管理器權限的成員立刻有自己的個人資料夾。
 * 都是系統動作：稽核的操作者是 system。
 */
@Injectable()
export class FileSystemFolderService
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(FileSystemFolderService.name);
  private unsubscribers: Array<() => void> = [];

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: FileFolderRepository,
    private readonly grants: ResourceGrantService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.unsubscribers = [
      this.events.subscribe(DomainEvent.PERMISSIONS_CHANGED, ({ userIds }) =>
        this.ensurePersonalFoldersOf(userIds),
      ),
      this.events.subscribe(DomainEvent.RESOURCE_CHANGED, async ({ changes }) => {
        // 新的工作區：立刻有共用／私人資料夾
        for (const id of createdWorkspaceIds(changes)) {
          // oxlint-disable-next-line no-await-in-loop -- 一次通常只建立一個工作區
          await this.ensureSystemFolders(workspaceScopeOf(id));
        }
        // 使用者被刪除：空的個人資料夾跟著刪除（有東西的保留給管理者整理）
        await this.removeEmptyPersonalFolders(deletedUserIds(changes));
      }),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const id of await this.repo.listWorkspaceIds()) {
      const ws = workspaceScopeOf(id);
      // oxlint-disable-next-line no-await-in-loop -- 啟動時一次；每個工作區各自一個交易
      await this.ensureSystemFolders(ws);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await this.ensurePersonalFolders(ws, await this.repo.findFileManagerMemberIds(ws));
    }
    // 服務沒在跑時刪除的使用者：啟動時補做
    await this.removeEmptyPersonalFolders();
  }

  /**
   * 擁有者已被刪除、而且裡面是空的個人資料夾（所有工作區）：軟刪除（docs/rbac/07-resource-grants.md §12）。
   * `ownerIds` 不帶時檢查全部。裡面有東西的保留，由管理者整理。
   */
  async removeEmptyPersonalFolders(ownerIds?: readonly string[]): Promise<void> {
    if (ownerIds?.length === 0) return;
    const candidates = await this.repo.findPersonalOfDeletedOwners(ownerIds);
    const byWorkspace = groupBy(candidates, (folder) => folder.workspaceId);
    for (const [workspaceId, folders] of byWorkspace) {
      const ws = workspaceScopeOf(workspaceId);
      // oxlint-disable-next-line no-await-in-loop -- 每個工作區各自排隊；只有被刪除的使用者
      const removed = await this.writeTree(ws, async (tx) => {
        const ids: string[] = [];
        for (const folder of folders) {
          // oxlint-disable-next-line no-await-in-loop -- 同一個交易依序
          if (!(await this.repo.isEmpty(folder.id, tx))) continue;
          // oxlint-disable-next-line no-await-in-loop -- 同上
          await this.repo.softDelete([folder.id], null, tx);
          // oxlint-disable-next-line no-await-in-loop -- 同上
          await this.audit.record(
            {
              action: 'fileFolder.delete',
              resourceType: 'fileFolder',
              resourceId: folder.id,
              resourceName: folder.name,
              actorId: null,
              actorEmail: 'system',
              changes: { before: { name: folder.name, kind: 'personal', ownerId: folder.ownerId } },
              metadata: { reason: 'owner-deleted', workspaceId },
            },
            tx,
          );
          ids.push(folder.id);
        }
        return ids;
      });
      if (removed.length > 0) {
        this.events.publish(DomainEvent.RESOURCE_CHANGED, {
          changes: removed.map((id) => ({
            resource: ChangeSource.FILE_FOLDER,
            kind: ChangeKind.DELETE,
            id,
          })),
          workspaceId,
        });
      }
    }
  }

  /** 這個工作區的共用資料夾與私人資料夾存在（冪等）；回傳私人資料夾。 */
  async ensureSystemFolders(ws: WorkspaceScope): Promise<FileFolderRow> {
    const { privateRoot, created } = await this.writeTree(ws, async (tx) => {
      const createdIds: string[] = [];
      const shared = await this.ensureSingleton(ws, 'shared', SHARED_FOLDER_NAME, tx, createdIds);
      if (createdIds.includes(shared.id)) {
        await this.grants.set(
          {
            resourceType: 'fileFolder',
            resourceId: shared.id,
            subjectType: 'everyone',
            subjectId: EVERYONE_SUBJECT_ID,
          },
          { level: 'editor', expiresAt: null, grantedBy: null },
          tx,
        );
      }
      const root = await this.ensureSingleton(
        ws,
        'privateRoot',
        PRIVATE_ROOT_FOLDER_NAME,
        tx,
        createdIds,
      );
      return { privateRoot: root, created: createdIds };
    });
    if (created.length > 0) this.publish(ws);
    return privateRoot;
  }

  /** 這些使用者在他們所屬的每個工作區，取得檔案管理器權限而還沒有個人資料夾的就建立。 */
  async ensurePersonalFoldersOf(userIds: readonly string[]): Promise<void> {
    const memberships = await this.repo.findMemberships(userIds);
    const byWorkspace = groupBy(memberships, (membership) => membership.workspaceId);
    for (const [workspaceId, members] of byWorkspace) {
      // oxlint-disable-next-line no-await-in-loop -- 受影響的人所屬的工作區數有限
      await this.ensurePersonalFolders(
        workspaceScopeOf(workspaceId),
        members.map((member) => member.userId),
        { onlyEligible: true },
      );
    }
  }

  /**
   * 為這些成員在這個工作區補建個人資料夾（已有的略過）。`onlyEligible`：先確認他們現在在這個工作區
   * 能進檔案管理器（`permissions.changed` 的對象不一定取得了檔案權限）。
   */
  async ensurePersonalFolders(
    ws: WorkspaceScope,
    userIds: readonly string[],
    options: { onlyEligible?: boolean } = {},
  ): Promise<void> {
    const candidates = options.onlyEligible
      ? await this.eligible(ws, userIds)
      : [...new Set(userIds)];
    if (candidates.length === 0) return;
    const existing = await this.repo.findPersonalOwnerIds(ws, candidates);
    const missing = candidates.filter((id) => !existing.has(id));
    if (missing.length === 0) return;

    const privateRoot = await this.ensureSystemFolders(ws);
    const people = await this.repo.findUsers(missing);
    const created = await this.writeTree(ws, async (tx) => {
      // 排隊之後再查一次：併發的另一個請求可能已經建好了
      const owners = await this.repo.findPersonalOwnerIds(ws, missing, tx);
      const rows: FileFolderRow[] = [];
      for (const person of people.filter((user) => !owners.has(user.id))) {
        // 同一層不可同名（不分大小寫）：同名的人加上 email 區分
        // oxlint-disable-next-line no-await-in-loop -- 同一個交易依序寫入；只有新取得權限的人
        const taken = await this.repo.hasSibling(
          ws,
          privateRoot.id,
          person.displayName,
          undefined,
          tx,
        );
        const name = taken ? `${person.displayName} (${person.email})` : person.displayName;
        // oxlint-disable-next-line no-await-in-loop -- 同上
        const [row] = await this.repo.create(
          [
            {
              workspaceId: ws.workspaceId,
              name,
              parentId: privateRoot.id,
              kind: 'personal',
              ownerId: person.id,
              inheritGrants: false,
              createdBy: person.id,
              updatedBy: person.id,
            },
          ],
          tx,
        );
        if (!row) continue;
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.grants.set(
          {
            resourceType: 'fileFolder',
            resourceId: row.id,
            subjectType: 'user',
            subjectId: person.id,
          },
          { level: 'manager', expiresAt: null, grantedBy: null },
          tx,
        );
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.audit.record(
          {
            action: 'fileFolder.create',
            resourceType: 'fileFolder',
            resourceId: row.id,
            resourceName: row.name,
            actorId: null,
            actorEmail: 'system',
            changes: { after: { name: row.name, kind: 'personal', ownerId: person.id } },
            metadata: { workspaceId: ws.workspaceId },
          },
          tx,
        );
        rows.push(row);
      }
      return rows;
    });
    if (created.length > 0) {
      this.logger.log({ count: created.length, workspaceId: ws.workspaceId }, '建立個人資料夾');
      this.publish(ws);
    }
  }

  /**
   * 在這個工作區能進檔案管理器（頁面的閘門：`file:access` 或 `file:read`，或 super-admin）。
   * 呼叫端傳入的都是成員；不是成員的 super-admin 不為他建個人資料夾（D5）。
   */
  private async eligible(ws: WorkspaceScope, userIds: readonly string[]): Promise<string[]> {
    const result: string[] = [];
    for (const id of new Set(userIds)) {
      // oxlint-disable-next-line no-await-in-loop -- 權限集合有快取；受影響的人數有限
      const { permissions, isSuperAdmin } = await this.permissions.getWorkspacePermissionSet(
        id,
        ws.workspaceId,
      );
      if (
        isSuperAdmin ||
        permissions.has(PERMISSION.FILE_ACCESS) ||
        permissions.has(PERMISSION.FILE_READ)
      ) {
        result.push(id);
      }
    }
    return result;
  }

  /** 找到就用；根目錄已有同名的一般資料夾就把它標成系統資料夾；都沒有就建立。 */
  private async ensureSingleton(
    ws: WorkspaceScope,
    kind: 'shared' | 'privateRoot',
    name: string,
    tx: DbOrTx,
    createdIds: string[],
  ): Promise<FileFolderRow> {
    const existing = await this.repo.findSingleton(ws, kind, tx);
    if (existing) return existing;
    const sameName = (await this.repo.findChildren(ws, [null], tx)).find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.kind === 'normal',
    );
    if (sameName) {
      await this.repo.setKind(sameName.id, kind, tx);
      createdIds.push(sameName.id);
      return { ...sameName, kind };
    }
    const [row] = await this.repo.create(
      [{ workspaceId: ws.workspaceId, name, parentId: null, kind }],
      tx,
    );
    if (!row) throw new Error(`建立系統資料夾失敗：${name}`);
    await this.audit.record(
      {
        action: 'fileFolder.create',
        resourceType: 'fileFolder',
        resourceId: row.id,
        resourceName: row.name,
        actorId: null,
        actorEmail: 'system',
        changes: { after: { name: row.name, kind } },
        metadata: { workspaceId: ws.workspaceId },
      },
      tx,
    );
    createdIds.push(row.id);
    return row;
  }

  /** 與這個工作區資料夾的其他結構寫入排隊（docs/architecture/backend/09-file.md §4.2）。 */
  private writeTree<T>(ws: WorkspaceScope, work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return withTransaction(this.db, async (tx) => {
      await this.repo.lockTree(ws, tx);
      return work(tx);
    });
  }

  private publish(ws: WorkspaceScope): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE }],
      workspaceId: ws.workspaceId,
    });
  }
}

/** 這批變更裡被刪除的使用者。 */
function deletedUserIds(changes: readonly ResourceChangeWire[]): string[] {
  return changes.flatMap((change) =>
    change.resource === ChangeSource.USER && change.kind === ChangeKind.DELETE && change.id
      ? [change.id]
      : [],
  );
}

/** 這批變更裡新建立的工作區。 */
function createdWorkspaceIds(changes: readonly ResourceChangeWire[]): string[] {
  return changes.flatMap((change) =>
    change.resource === ChangeSource.WORKSPACE && change.kind === ChangeKind.CREATE && change.id
      ? [change.id]
      : [],
  );
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
