import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx, MissedUpdateCodes, Transaction } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException, constraintNameOf, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { requireTenant } from '@/core/tenant';
import type { TagColor, TagRow } from '@/db/schema';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionCheckContext } from '@/modules/permission/permission.service';

import type {
  CreateTagDto,
  ReplaceResourceTagsDto,
  UpdateResourceTagsDto,
  ResourceTagsDto,
  TagDto,
  TagListDto,
  TagSummaryDto,
  UpdateTagDto,
} from './dto/tag.dto';
import {
  TAG_MAX_PER_RESOURCE,
  TAG_MAX_PER_SCOPE,
  TAG_NAME_UNIQUE_CONSTRAINT,
} from './tag.constants';
import { TagRepository } from './tag.repository';
import type { TagResourceDefinition, TagScopeDefinition } from './tag.types';

function toDto(row: TagRow): TagDto {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    color: row.color as TagColor,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const TAG_AUDIT_FIELDS = ['name', 'color'] as const;

/**
 * 標籤（docs/architecture/backend/18-tag.md §7）：定義的增刪改、資源的指派、給擁有者的批次讀取與清理。
 * 不認識任何業務模組：標籤組與資源類型由擁有者在 `onModuleInit` 登記（D1、D7）。
 */
/** 樂觀鎖的條件式 UPDATE 沒命中時的錯誤碼（`missedUpdate`）。 */
const TAG_LOCK_CODES = {
  notFound: 'TAG_NOT_FOUND',
  conflict: 'TAG_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

@Injectable()
export class TagService {
  private readonly scopes = new Map<string, TagScopeDefinition>();
  private readonly resources = new Map<string, TagResourceDefinition>();

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: TagRepository,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  // ── 登記（擁有者模組呼叫） ─────────────────────────────

  registerScope(definition: TagScopeDefinition): void {
    if (this.scopes.has(definition.scope)) {
      throw new Error(`標籤組 ${definition.scope} 重複登記`);
    }
    this.scopes.set(definition.scope, definition);
  }

  registerResource(definition: TagResourceDefinition): void {
    if (this.resources.has(definition.resourceType)) {
      throw new Error(`可貼標籤的資源 ${definition.resourceType} 重複登記`);
    }
    this.resources.set(definition.resourceType, definition);
  }

  // ── 給擁有者：批次讀取、清理 ─────────────────────────

  /** 這些資源各自的標籤（依名稱排序）；沒有標籤的資源對到空陣列。擁有者組回應時一次取得（D6）。 */
  async tagsOf(
    resourceType: string,
    resourceIds: readonly string[],
  ): Promise<Map<string, TagSummaryDto[]>> {
    const result = new Map<string, TagSummaryDto[]>(resourceIds.map((id) => [id, []]));
    for (const tag of await this.repo.tagsOf(resourceType, resourceIds)) {
      result.get(tag.resourceId)?.push({ id: tag.id, name: tag.name, color: tag.color });
    }
    return result;
  }

  /** 資源永久刪除時，在擁有者的交易內清掉它們的指派（D9）。 */
  removeAllFor(resourceType: string, resourceIds: readonly string[], tx: DbOrTx): Promise<void> {
    return this.repo.removeAllFor(resourceType, resourceIds, tx);
  }

  // ── 定義 ─────────────────────────────────────────────

  /** 一個標籤組的標籤：要進得了這個標籤組（D5）。 */
  async list(scope: string, actor: AuthUser): Promise<TagListDto> {
    const definition = this.requireScope(scope);
    await definition.assertCanBrowse(actor, { route: 'GET /tags', metadata: { scope } });
    return { items: (await this.repo.listByScope(scope)).map(toDto) };
  }

  async create(dto: CreateTagDto, actor: AuthUser): Promise<TagDto> {
    const created = await this.uniqueName(() =>
      withTransaction(this.db, (tx) => this.createInTx(dto, actor, tx)),
    );
    this.publish(ChangeKind.CREATE, created.id);
    return toDto(created);
  }

  /** 建立的業務規則與寫入，在呼叫端的交易內（API 與匯入共用一份規則）。交易提交後呼叫端要 `publishChanged()`。 */
  async createInTx(dto: CreateTagDto, actor: AuthUser, tx: Transaction): Promise<TagRow> {
    this.requireScope(dto.scope);
    await this.repo.lockScope(dto.scope, tx);
    if ((await this.repo.countInScope(dto.scope, tx)) >= TAG_MAX_PER_SCOPE) {
      throw new AppException('TAG_LIMIT_REACHED', { max: TAG_MAX_PER_SCOPE });
    }
    // 預先檢查同名：唯一索引撞到時整個交易已經中止，匯入的一列要拿到明確的錯誤碼
    if ((await this.repo.findByNames(dto.scope, [dto.name], tx)).length) {
      throw new AppException('TAG_NAME_DUPLICATE');
    }
    const row = await this.repo.create(
      {
        scope: dto.scope,
        name: dto.name,
        color: dto.color,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'tag.create',
        resourceType: RESOURCE_TYPE.TAG,
        resourceId: row.id,
        resourceName: row.name,
        changes: { after: { scope: row.scope, name: row.name, color: row.color } },
      },
      tx,
    );
    return row;
  }

  /** 改名、改色（帶 `version`）。標籤組不能改：已貼上的資源屬於原本的組。 */
  async update(id: string, dto: UpdateTagDto, actor: AuthUser): Promise<TagDto> {
    const updated = await this.uniqueName(() =>
      withTransaction(this.db, (tx) => this.updateInTx(id, dto, actor, tx)),
    );
    this.publish(ChangeKind.UPDATE, id);
    return toDto(updated);
  }

  /** 改名、改色的業務規則與寫入，在呼叫端的交易內。 */
  async updateInTx(
    id: string,
    dto: UpdateTagDto,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<TagRow> {
    const current = await this.getExisting(id);
    this.requireScope(current.scope);
    if (dto.version !== current.version) {
      throw new AppException('TAG_VERSION_CONFLICT', { current: current.version });
    }
    if (
      dto.name !== undefined &&
      dto.name.toLowerCase() !== current.name.toLowerCase() &&
      (await this.repo.findByNames(current.scope, [dto.name], tx)).length
    ) {
      throw new AppException('TAG_NAME_DUPLICATE');
    }
    const row = await this.repo.update(
      id,
      {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.color !== undefined && { color: dto.color }),
        updatedBy: actor.id,
      },
      dto.version,
      tx,
    );
    if (!row) throw await missedUpdate(() => this.repo.findVersion(id, tx), TAG_LOCK_CODES);
    const changes = diff(current, row, TAG_AUDIT_FIELDS);
    if (changes) {
      await this.audit.record(
        {
          action: 'tag.update',
          resourceType: RESOURCE_TYPE.TAG,
          resourceId: id,
          resourceName: row.name,
          changes,
        },
        tx,
      );
    }
    return row;
  }

  /** 交易提交後的推播（匯入的套用工作合併後呼叫）。 */
  publishChanged(kind: ChangeKind, id: string): void {
    this.publish(kind, id);
  }

  /** 所有登記的標籤組（不看租戶）：匯入匯出的「標籤組」欄的選項。 */
  registeredScopes(): TagScopeDefinition[] {
    return [...this.scopes.values()];
  }

  /** 目前租戶可用的標籤組（所屬 feature 已啟用）。 */
  availableScopes(): TagScopeDefinition[] {
    const features = requireTenant().features;
    return [...this.scopes.values()].filter(
      (definition) => !definition.feature || features.includes(definition.feature),
    );
  }

  /** 進得了這個標籤組（D5）；進不了拋 `AUTHZ_FORBIDDEN` 並寫 `authz.denied`。 */
  async assertCanBrowse(
    scope: string,
    actor: AuthUser,
    context: PermissionCheckContext,
  ): Promise<void> {
    await this.requireScope(scope).assertCanBrowse(actor, context);
  }

  /** 硬刪除，指派一併刪除（D4）；稽核記下名稱、組與當時貼著的資源數。 */
  async remove(id: string): Promise<void> {
    const current = await this.getExisting(id);
    await withTransaction(this.db, async (tx) => {
      const assigned = await this.repo.delete(id, tx);
      if (assigned === undefined) throw new AppException('TAG_NOT_FOUND');
      await this.audit.record(
        {
          action: 'tag.delete',
          resourceType: RESOURCE_TYPE.TAG,
          resourceId: id,
          resourceName: current.name,
          changes: { before: { scope: current.scope, name: current.name, color: current.color } },
          metadata: { assignedResources: assigned },
        },
        tx,
      );
    });
    this.publish(ChangeKind.DELETE, id);
  }

  // ── 指派 ─────────────────────────────────────────────

  /**
   * 整批取代一個資源的標籤（D7）：能不能改由擁有者判斷；標籤必須屬於那個資源類型的標籤組。
   * 交易提交後由擁有者推自己的資源變更（D10）。
   */
  async replaceFor(
    resourceType: string,
    resourceId: string,
    dto: ReplaceResourceTagsDto,
    actor: AuthUser,
  ): Promise<ResourceTagsDto> {
    return this.assign(resourceType, resourceId, actor, 'PUT', () => dto.tagIds);
  }

  /** 差異語意：在交易內、鎖住這個資源之後讀出目前的標籤再加減，和同時的寫入不會互相覆蓋。 */
  async updateFor(
    resourceType: string,
    resourceId: string,
    dto: UpdateResourceTagsDto,
    actor: AuthUser,
  ): Promise<ResourceTagsDto> {
    return this.assign(resourceType, resourceId, actor, 'PATCH', (current) => {
      const removed = new Set(dto.remove);
      return [...new Set([...current, ...dto.add])].filter((id) => !removed.has(id));
    });
  }

  /**
   * 指派的共同流程：資源的編輯權限（resolver）→ 交易內鎖住資源、讀出目前的標籤、算出新的 → 數量上限、
   * 標籤要在這個標籤組 → 寫入與稽核（沒有變化就不寫）→ 交易後 `afterTagsChanged`。
   */
  private async assign(
    resourceType: string,
    resourceId: string,
    actor: AuthUser,
    method: 'PUT' | 'PATCH',
    next: (current: readonly string[]) => readonly string[],
  ): Promise<ResourceTagsDto> {
    const definition = this.resources.get(resourceType);
    if (!definition) throw new AppException('TAG_SCOPE_NOT_FOUND', { resourceType });
    this.requireScope(definition.scope);
    const target = await definition.resolveEditable(actor, resourceId, {
      route: `${method} /tags/assignments/:resourceType/:resourceId`,
      metadata: { resourceType, resourceId },
    });

    const changed = await withTransaction(this.db, async (tx) => {
      await this.repo.lockResource(resourceType, resourceId, tx);
      const before = await this.repo.tagsOf(resourceType, [resourceId], tx);
      const tagIds = next(before.map((tag) => tag.id));
      if (tagIds.length > TAG_MAX_PER_RESOURCE) {
        throw new AppException('TAG_LIMIT_REACHED', { max: TAG_MAX_PER_RESOURCE });
      }
      const found = await this.repo.findInScope(definition.scope, tagIds, tx);
      const foundIds = new Set(found.map((tag) => tag.id));
      const missing = tagIds.filter((id) => !foundIds.has(id));
      if (missing.length) throw new AppException('TAG_NOT_FOUND', { tagIds: missing });

      const beforeIds = new Set(before.map((tag) => tag.id));
      const same = before.length === foundIds.size && before.every((tag) => foundIds.has(tag.id));
      if (same) return false;
      await this.repo.replace(resourceType, resourceId, tagIds, actor.id, tx);
      const names = (rows: ReadonlyArray<{ name: string }>) =>
        rows.map((row) => row.name).toSorted();
      await this.audit.record(
        {
          action: 'tag.assign',
          resourceType,
          resourceId,
          resourceName: target.name,
          changes: {
            before: { tags: names(before) },
            after: { tags: names(found) },
          },
          metadata: {
            added: found.filter((tag) => !beforeIds.has(tag.id)).map((tag) => tag.id),
            removed: before.filter((tag) => !foundIds.has(tag.id)).map((tag) => tag.id),
          },
        },
        tx,
      );
      return true;
    });

    if (changed) await definition.afterTagsChanged(resourceId);
    return { tags: (await this.tagsOf(resourceType, [resourceId])).get(resourceId) ?? [] };
  }

  // ── 業務規則 ─────────────────────────────────────────

  /** 標籤組要有登記，所屬 feature 要啟用（D12）。 */
  private requireScope(scope: string): TagScopeDefinition {
    const definition = this.scopes.get(scope);
    if (!definition) throw new AppException('TAG_SCOPE_NOT_FOUND', { scope });
    if (definition.feature && !requireTenant().features.includes(definition.feature)) {
      throw new AppException('FEATURE_DISABLED', { feature: definition.feature });
    }
    return definition;
  }

  private async getExisting(id: string): Promise<TagRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('TAG_NOT_FOUND');
    return row;
  }

  /** 名稱唯一索引撞到（含預檢查之後被併發的同名搶先）→ `TAG_NAME_DUPLICATE`。 */
  private async uniqueName<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error) && constraintNameOf(error) === TAG_NAME_UNIQUE_CONSTRAINT) {
        throw new AppException('TAG_NAME_DUPLICATE');
      }
      throw error;
    }
  }

  private publish(kind: ChangeKind, id: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.TAG, kind, id }],
    });
  }
}
