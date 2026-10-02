import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { DbOrTx } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { Tenancy } from '@/core/tenant';
import type { FileFolderRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { FileFolderGrantRepository } from './file-folder-grant.repository';
import { FileFolderTree } from './file-folder-tree';
import { FileFolderRepository } from './file-folder.repository';
import { EVERYONE_SUBJECT_ID } from './file-grant.levels';

/** 系統資料夾的名稱（建立時；之後不能改名）。 */
export const SHARED_FOLDER_NAME = '共用資料夾';
export const PRIVATE_ROOT_FOLDER_NAME = '私人資料夾';

/**
 * 系統資料夾（docs/rbac/07-resource-grants.md §12）：
 * - 共用資料夾：所有人（`everyone`）是 editor；
 * - 私人資料夾：容器，沒有授權；底下每個能進檔案管理器的人一個個人資料夾（本人 manager、不繼承上層）。
 *
 * 啟動時確保共用／私人資料夾存在並補建個人資料夾（冪等）；之後訂閱 `permissions.changed`，
 * 取得檔案管理器權限的人立刻有自己的個人資料夾。都是系統動作：稽核的操作者是 system。
 */
@Injectable()
export class FileSystemFolderService
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(FileSystemFolderService.name);
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly tree: FileFolderTree,
    private readonly repo: FileFolderRepository,
    private readonly grants: FileFolderGrantRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly tenancy: Tenancy,
  ) {}

  onModuleInit(): void {
    this.unsubscribers = [
      // 只有發起寫入的程序知道是誰（其他程序收到的廣播沒有名單）：個人資料夾建在 DB，建一次就夠
      this.events.subscribe(DomainEvent.PERMISSIONS_CHANGED, ({ userIds }) =>
        userIds ? this.ensurePersonalFolders(userIds, { onlyEligible: true }) : undefined,
      ),
      // 新佈建或重新啟用的租戶：不等重啟就補上系統資料夾（事件在那個租戶的脈絡裡發佈）
      this.events.subscribe(DomainEvent.TENANT_ACTIVATED, () => this.prepareTenant()),
      // 使用者被刪除：空的個人資料夾跟著刪除（有東西的保留給管理者整理）
      this.events.subscribe(DomainEvent.RESOURCE_CHANGED, ({ changes }) =>
        this.removeEmptyPersonalFolders(deletedUserIds(changes)),
      ),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  /** 每個 `active` 的租戶各一套系統資料夾（docs/architecture/05-tenancy.md §10.2 D3）。 */
  async onApplicationBootstrap(): Promise<void> {
    await this.tenancy.forEachActive(() => this.prepareTenant());
  }

  /** 目前租戶的系統資料夾與個人資料夾；服務沒在跑時刪除的使用者也在這時補做。冪等。 */
  async prepareTenant(): Promise<void> {
    await this.ensureSystemFolders();
    // 權限由關係圖解析（含 user:* 與依賴樹）：不在這裡另寫一套查詢，交給 PermissionService 篩
    await this.ensurePersonalFolders(await this.repo.findActiveUserIds(), { onlyEligible: true });
    await this.removeEmptyPersonalFolders();
  }

  /**
   * 擁有者已被刪除、而且裡面是空的個人資料夾：軟刪除（docs/rbac/07-resource-grants.md §12）。
   * `ownerIds` 不帶時檢查全部。裡面有東西的保留，由管理者整理。
   */
  async removeEmptyPersonalFolders(ownerIds?: readonly string[]): Promise<void> {
    if (ownerIds?.length === 0) return;
    const removed = await this.writeTree(async (tx) => {
      const candidates = await this.repo.findPersonalOfDeletedOwners(ownerIds, tx);
      const ids: string[] = [];
      for (const folder of candidates) {
        // oxlint-disable-next-line no-await-in-loop -- 同一個交易依序；只有被刪除的使用者
        if (!(await this.repo.isEmpty(folder.id, tx))) continue;
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await this.repo.softDelete(
          [folder.id],
          { actorId: null, deletionId: randomUUID(), deletedAt: new Date() },
          tx,
        );
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
            metadata: { reason: 'owner-deleted' },
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
      });
    }
  }

  /** 共用資料夾與私人資料夾存在（冪等）；回傳私人資料夾。 */
  async ensureSystemFolders(): Promise<FileFolderRow> {
    const { privateRoot, created } = await this.writeTree(async (tx) => {
      const createdIds: string[] = [];
      const shared = await this.ensureSingleton('shared', SHARED_FOLDER_NAME, tx, createdIds);
      if (createdIds.includes(shared.id)) {
        await this.grants.set(
          { folderId: shared.id, subjectType: 'everyone', subjectId: EVERYONE_SUBJECT_ID },
          { level: 'editor', expiresAt: null, grantedBy: null },
          tx,
        );
      }
      const root = await this.ensureSingleton(
        'privateRoot',
        PRIVATE_ROOT_FOLDER_NAME,
        tx,
        createdIds,
      );
      return { privateRoot: root, created: createdIds };
    });
    if (created.length > 0) this.publish();
    return privateRoot;
  }

  /**
   * 為這些使用者補建個人資料夾（已有的略過）。`onlyEligible`：先確認他們現在能進檔案管理器
   * （`permissions.changed` 的對象不一定取得了檔案權限）。
   */
  async ensurePersonalFolders(
    userIds: readonly string[],
    options: { onlyEligible?: boolean } = {},
  ): Promise<void> {
    const candidates = options.onlyEligible ? await this.eligible(userIds) : [...new Set(userIds)];
    if (candidates.length === 0) return;
    const existing = await this.repo.findPersonalOwnerIds(candidates);
    const missing = candidates.filter((id) => !existing.has(id));
    if (missing.length === 0) return;

    const privateRoot = await this.ensureSystemFolders();
    const people = await this.repo.findUsers(missing);
    const created = await this.writeTree(async (tx) => {
      // 排隊之後再查一次：併發的另一個請求可能已經建好了
      const owners = await this.repo.findPersonalOwnerIds(missing, tx);
      const rows: FileFolderRow[] = [];
      for (const person of people.filter((user) => !owners.has(user.id))) {
        try {
          // 每人一個 savepoint：一個人失敗（例：名稱在競態下撞到唯一索引）只 rollback 他自己，
          // 不讓同一批其他人的個人資料夾跟著建不成
          // oxlint-disable-next-line no-await-in-loop -- 同一個交易依序寫入；只有新取得權限的人
          const row = await tx.transaction((savepoint) =>
            this.createPersonalFolder(person, privateRoot.id, savepoint),
          );
          rows.push(row);
        } catch (error) {
          this.logger.warn({ err: error, userId: person.id }, '建立個人資料夾失敗，其他人照常建立');
        }
      }
      return rows;
    });
    if (created.length > 0) {
      this.logger.log({ count: created.length }, '建立個人資料夾');
      this.publish();
    }
  }

  /** 一個人的個人資料夾：挑一個同一層沒人用的名稱、授予本人 manager、寫稽核。 */
  private async createPersonalFolder(
    person: { id: string; displayName: string; email: string },
    parentId: string,
    tx: DbOrTx,
  ): Promise<FileFolderRow> {
    let name = personalFolderName(person, 0);
    for (let attempt = 1; attempt <= MAX_NUMBERED_NAME + 1; attempt += 1) {
      // 同一層不可同名（不分大小寫）：依序加上 email、編號，直到沒人用
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易依序查詢；碰撞的機會很小
      if (!(await this.repo.hasSibling(parentId, name, undefined, tx))) break;
      name = personalFolderName(person, attempt);
    }
    const [row] = await this.repo.create(
      [
        {
          name,
          parentId,
          kind: 'personal',
          ownerId: person.id,
          inheritGrants: false,
          createdBy: person.id,
          updatedBy: person.id,
        },
      ],
      tx,
    );
    if (!row) throw new Error('建立個人資料夾失敗');
    await this.grants.set(
      { folderId: row.id, subjectType: 'user', subjectId: person.id },
      { level: 'manager', expiresAt: null, grantedBy: null },
      tx,
    );
    await this.audit.record(
      {
        action: 'fileFolder.create',
        resourceType: 'fileFolder',
        resourceId: row.id,
        resourceName: row.name,
        actorId: null,
        actorEmail: 'system',
        changes: { after: { name: row.name, kind: 'personal', ownerId: person.id } },
      },
      tx,
    );
    return row;
  }

  /** 能進檔案管理器（頁面的閘門：`file:access` 或 `file:read`，或 super-admin）。 */
  private async eligible(userIds: readonly string[]): Promise<string[]> {
    // 一次批次解析：角色權限變更時受影響的可能是上千人
    const sets = await this.permissions.getPermissionSets(userIds);
    return (
      [...sets]
        // 權限集合是依賴樹的閉包：任何 file:* 都帶來 file:access（docs/rbac/02-permission-catalog.md §9）
        .filter(
          ([, { permissions, isSuperAdmin }]) =>
            isSuperAdmin || permissions.has(PERMISSION.FILE_ACCESS),
        )
        .map(([id]) => id)
    );
  }

  /** 找到就用；根目錄已有同名的一般資料夾就把它標成系統資料夾；都沒有就建立。 */
  private async ensureSingleton(
    kind: 'shared' | 'privateRoot',
    name: string,
    tx: DbOrTx,
    createdIds: string[],
  ): Promise<FileFolderRow> {
    const existing = await this.repo.findSingleton(kind, tx);
    if (existing) return existing;
    const sameName = (await this.repo.findChildren([null], tx)).find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.kind === 'normal',
    );
    if (sameName) {
      await this.repo.setKind(sameName.id, kind, tx);
      createdIds.push(sameName.id);
      return { ...sameName, kind };
    }
    const [row] = await this.repo.create([{ name, parentId: null, kind }], tx);
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
      },
      tx,
    );
    createdIds.push(row.id);
    return row;
  }

  /** 與資料夾的其他結構寫入排隊（docs/architecture/backend/09-file.md §4.2）。 */
  private writeTree<T>(work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return this.tree.write(work);
  }

  private publish(): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE }],
    });
  }
}

/** 資料夾名稱的長度上限（同 `FileFolderNameSchema`）。 */
const MAX_FOLDER_NAME_LENGTH = 255;
/** 編號試到這裡還撞名就改用 user id（一定唯一）。 */
const MAX_NUMBERED_NAME = 20;

/** 顯示名稱不經過資料夾名稱的驗證：把 `/`、`\`、控制字元換成空白，`.`、`..` 視為沒有名稱。 */
function toFolderName(value: string): string {
  const cleaned = value
    // oxlint-disable-next-line no-control-regex -- 就是要排除控制字元
    .replaceAll(/[/\\\u0000-\u001f\u007f]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return cleaned === '.' || cleaned === '..' ? '' : cleaned;
}

/**
 * 個人資料夾的第 `attempt` 個候選名稱：顯示名稱 → 加上 email → 再加編號 → 最後用 user id。
 * 名稱一律符合資料夾名稱的規則（不含路徑分隔字元、控制字元，≤ 255）。
 */
export function personalFolderName(
  person: { id: string; displayName: string; email: string },
  attempt: number,
): string {
  const base = toFolderName(person.displayName) || toFolderName(person.email) || person.id;
  const email = toFolderName(person.email);
  const suffix =
    attempt === 0
      ? ''
      : attempt > MAX_NUMBERED_NAME
        ? ` (${person.id})`
        : attempt === 1
          ? ` (${email})`
          : ` (${email}) ${attempt}`;
  return `${base.slice(0, Math.max(1, MAX_FOLDER_NAME_LENGTH - suffix.length))}${suffix}`.slice(
    0,
    MAX_FOLDER_NAME_LENGTH,
  );
}

/** 這批變更裡被刪除的使用者。 */
function deletedUserIds(changes: readonly ResourceChangeWire[]): string[] {
  return changes.flatMap((change) =>
    change.resource === ChangeSource.USER && change.kind === ChangeKind.DELETE && change.id
      ? [change.id]
      : [],
  );
}
