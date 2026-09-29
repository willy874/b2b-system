import { Injectable } from '@nestjs/common';

import type { DbOrTx } from '@/core/database';
import type {
  GrantLevel,
  GrantSubjectType,
  ResourceGrantInsert,
  ResourceGrantRow,
  ResourceType,
} from '@/db/schema';

import { ResourceGrantRepository } from './resource-grant.repository';
import type { GrantKey, GrantSubjectRow, GrantWithSubject } from './resource-grant.repository';
import type { LevelGrant } from './resource-grant.resolver';

export type { GrantKey, GrantSubjectRow, GrantWithSubject };

/**
 * 資源授權的資料操作（docs/rbac/07-resource-grants.md §8）。通用：不認識資料夾、不判斷能不能授予——
 * 「誰能管理授權」「等級蘊含哪些動作」是每種資源自己的規則，由呼叫端（例：`FileAccessService`）決定；
 * 稽核也由呼叫端在同一個交易寫入（action 名稱屬於該資源）。
 */
@Injectable()
export class ResourceGrantService {
  constructor(private readonly repo: ResourceGrantRepository) {}

  /**
   * 操作者（本人 ＋ 在這個工作區持有的工作區角色）在這幾種資源上所有未過期的授權。
   * 上層鏈跨越多種資源時一次取齊；資源 id 都是 uuid，不會撞號。
   * 資源本身屬於工作區，以 id 比對就不會拿到別的工作區的資源（docs/adr/0018-workspace-tenancy.md D7）。
   */
  async grantsFor(
    userId: string,
    resourceTypes: readonly ResourceType[],
    workspaceId: string,
    tx?: DbOrTx,
    now = new Date(),
  ): Promise<LevelGrant[]> {
    const roleIds = await this.repo.findRoleIdsOfMember(userId, workspaceId, tx);
    return this.repo.findActiveForSubjects(resourceTypes, { userId, roleIds }, now, tx);
  }

  listOn(
    resourceType: ResourceType,
    resourceIds: readonly string[],
    tx?: DbOrTx,
  ): Promise<GrantWithSubject[]> {
    return this.repo.listOnResources(resourceType, resourceIds, tx);
  }

  find(key: GrantKey, tx?: DbOrTx): Promise<ResourceGrantRow | undefined> {
    return this.repo.findOne(key, tx);
  }

  set(
    key: GrantKey,
    /** `grantedBy` 為 null 是系統授予（例：系統資料夾，docs/rbac/07-resource-grants.md §12）。 */
    values: { level: GrantLevel; expiresAt: Date | null; grantedBy: string | null },
    tx?: DbOrTx,
  ): Promise<ResourceGrantRow> {
    return this.repo.upsert({ ...key, ...values }, tx);
  }

  insertMissing(values: ResourceGrantInsert[], tx?: DbOrTx): Promise<ResourceGrantRow[]> {
    return this.repo.insertMissing(values, tx);
  }

  revoke(key: GrantKey, tx?: DbOrTx): Promise<ResourceGrantRow | undefined> {
    return this.repo.delete(key, tx);
  }

  /** 對象存在，而且屬於這個工作區（工作區角色，或成員）。 */
  subjectExists(
    subjectType: GrantSubjectType,
    id: string,
    workspaceId: string,
    tx?: DbOrTx,
  ): Promise<boolean> {
    return this.repo.subjectExists(subjectType, id, workspaceId, tx);
  }

  searchSubjects(
    subjectType: GrantSubjectType,
    keyword: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<GrantSubjectRow[]> {
    return this.repo.searchSubjects(subjectType, keyword, limit, workspaceId);
  }
}
