import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import type { Database, DbOrTx, MissedUpdateCodes } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { decodeTimeIdCursor, encodeTimeIdCursor } from '@/core/http';
import type { TimeIdCursor } from '@/core/http';
import { RESOURCE_TYPE } from '@/core/resource';
import type { CommentRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';
import type { PermissionCheckContext } from '@/modules/permission/permission.service';

import {
  COMMENT_EXCERPT_LENGTH,
  MENTION_CANDIDATE_LIMIT,
  MENTION_SEARCH_POOL,
} from './comment.constants';
import {
  COMMENT_CREATED_NOTIFICATION,
  COMMENT_MENTIONED_NOTIFICATION,
} from './comment.notifications';
import type { CommentMentionedParams } from './comment.notifications';
import { CommentResourceRegistry } from './comment.registry';
import { CommentRepository } from './comment.repository';
import type { CommentUser, CommentWithAuthor } from './comment.repository';
import type { CommentResourceDefinition, CommentTarget } from './comment.types';
import type {
  CommentDto,
  CommentPageDto,
  CreateCommentDto,
  ListCommentDto,
  MentionableListDto,
  UpdateCommentDto,
} from './dto/comment.dto';
import { WatchService } from './watch.service';

const COMMENT_LOCK_CODES = {
  notFound: 'COMMENT_NOT_FOUND',
  conflict: 'COMMENT_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

/** 游標格式不對回 `400 VALIDATION_FAILED`（`details.field: 'cursor'`）。 */
function parseCursor(raw: string | undefined): TimeIdCursor | undefined {
  if (!raw) return undefined;
  const cursor = decodeTimeIdCursor(raw);
  if (!cursor) throw new AppException('VALIDATION_FAILED', { field: 'cursor' });
  return cursor;
}

/** 通知裡的摘要：空白壓成一個，超過上限加刪節號。 */
export function excerptOf(body: string): string {
  const flat = body.replaceAll(/\s+/g, ' ').trim();
  return flat.length > COMMENT_EXCERPT_LENGTH ? `${flat.slice(0, COMMENT_EXCERPT_LENGTH)}…` : flat;
}

/** 同一個操作者的「能不能管理別人的留言」：列表的每一列都要算 `canDelete`。 */
interface Viewer {
  id: string;
  canModerate: boolean;
}

/**
 * 留言（docs/architecture/backend/24-comment.md）。通用模組：不 import 任何業務模組，資源類型由擁有者登記（D2）；
 * 看得到資源就能讀與寫留言（D3），只有作者能編輯，作者或 `comment:delete` 能刪除。
 * 通知（@提及、關注者）與留言在同一個交易內寫入（docs/architecture/backend/15-notification.md §9）。
 */
@Injectable()
export class CommentService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: CommentRepository,
    private readonly registry: CommentResourceRegistry,
    private readonly watches: WatchService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  // ── 給擁有者：登記、清理 ─────────────────────────────

  /** 擁有者在 `onModuleInit` 登記一種可以留言與關注的資源（D2）。 */
  registerResource(definition: CommentResourceDefinition): void {
    this.registry.register(definition);
  }

  /** 資源永久刪除時，在擁有者的交易內清掉它們的留言與關注（D10）。 */
  async removeAllFor(
    resourceType: string,
    resourceIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    await this.repo.removeAllFor(resourceType, resourceIds, tx);
    await this.watches.removeAllFor(resourceType, resourceIds, tx);
  }

  // ── 端點 ─────────────────────────────────────────────

  async list(
    resourceType: string,
    resourceId: string,
    query: ListCommentDto,
    actor: AuthUser,
  ): Promise<CommentPageDto> {
    const definition = this.registry.require(resourceType);
    await definition.resolveViewable(
      actor,
      resourceId,
      context('GET /comments/:resourceType/:resourceId', { resourceType, resourceId }),
    );
    const rows = await this.repo.list(resourceType, resourceId, {
      limit: query.limit,
      after: parseCursor(query.cursor),
    });
    const viewer = await this.viewerOf(actor);
    const mentioned = await this.mentionedUsers(rows.flatMap((row) => row.comment.mentions));
    const last = rows.at(-1);
    return {
      items: rows.map((row) => toDto(row, mentioned, viewer)),
      nextCursor:
        last && rows.length === query.limit
          ? encodeTimeIdCursor({ createdAt: last.createdAtExact, id: last.comment.id })
          : null,
    };
  }

  /**
   * 留言：被提及的人要看得到資源（否則 `422 COMMENT_MENTION_INVALID`）；作者自動關注（D8）；
   * 被提及的人與關注者各收到一則通知（同一個人只收提及的那則）。
   */
  async create(
    resourceType: string,
    resourceId: string,
    dto: CreateCommentDto,
    actor: AuthUser,
  ): Promise<CommentDto> {
    const definition = this.registry.require(resourceType);
    const target = await definition.resolveViewable(
      actor,
      resourceId,
      context('POST /comments/:resourceType/:resourceId', { resourceType, resourceId }),
    );
    const mentionIds = await this.assertMentionable(definition, resourceId, dto.mentionIds);
    // 收件人在交易之前算好（docs/architecture/backend/15-notification.md §5）
    const mentioned = new Set(mentionIds);
    const watcherIds = (await this.watches.watcherIds(resourceType, resourceId)).filter(
      (id) => id !== actor.id && !mentioned.has(id),
    );
    const watchers = await definition.filterViewers(resourceId, watcherIds);
    const params = paramsOf(resourceType, target, dto.body);

    const { row, startedWatching } = await withTransaction(this.db, async (tx) => {
      const created = await this.repo.create(
        { resourceType, resourceId, authorId: actor.id, body: dto.body, mentions: mentionIds },
        tx,
      );
      const started = await this.watches.watchInTx(resourceType, resourceId, actor.id, tx);
      const inputs = [
        ...mentionIds.map((recipientId) =>
          notification(COMMENT_MENTIONED_NOTIFICATION, {
            recipientId,
            actorId: actor.id,
            params,
            link: target.link,
          }),
        ),
        ...watchers.map((recipientId) =>
          notification(COMMENT_CREATED_NOTIFICATION, {
            recipientId,
            actorId: actor.id,
            params,
            link: target.link,
          }),
        ),
      ];
      if (inputs.length) await this.notifications.notify(inputs, tx);
      return { row: created, startedWatching: started };
    });

    this.publish(definition, ChangeKind.CREATE, row);
    if (startedWatching) this.watches.publishWatchChanged(actor.id, resourceId);
    return this.single(row, actor);
  }

  /** 編輯：只有作者（帶 `version`）；新加入的被提及者才收到通知。 */
  async update(id: string, dto: UpdateCommentDto, actor: AuthUser): Promise<CommentDto> {
    const current = await this.getExisting(id);
    const definition = this.registry.require(current.resourceType);
    const route = 'PATCH /comments/:id';
    const target = await definition.resolveViewable(
      actor,
      current.resourceId,
      context(route, { commentId: id }),
    );
    if (current.authorId !== actor.id) throw await this.denyNotAuthor(actor, id, route);
    if (dto.version !== current.version) {
      throw new AppException('COMMENT_VERSION_CONFLICT', { current: current.version });
    }
    // 只驗證新加入的人：原本提及的人之後停用或失去權限，不該讓作者改不了錯字
    const before = new Set(current.mentions);
    const added = await this.assertMentionable(
      definition,
      current.resourceId,
      dto.mentionIds.filter((userId) => !before.has(userId)),
    );
    const mentionIds = dto.mentionIds;
    const params = paramsOf(current.resourceType, target, dto.body);

    const updated = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.update(
        id,
        { body: dto.body, mentions: mentionIds },
        dto.version,
        tx,
      );
      if (!row) throw await missedUpdate(() => this.repo.findVersion(id, tx), COMMENT_LOCK_CODES);
      if (added.length) {
        await this.notifications.notify(
          added.map((recipientId) =>
            notification(COMMENT_MENTIONED_NOTIFICATION, {
              recipientId,
              actorId: actor.id,
              params,
              link: target.link,
            }),
          ),
          tx,
        );
      }
      return row;
    });

    this.publish(definition, ChangeKind.UPDATE, updated);
    return this.single(updated, actor);
  }

  /**
   * 刪除（硬刪除，D5）：作者本人，或持有 `comment:delete` 的人。刪別人的留言寫稽核 `comment.delete`（D4）；
   * 刪自己的不寫。
   */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const current = await this.getExisting(id);
    const definition = this.registry.require(current.resourceType);
    const route = 'DELETE /comments/:id';
    const target = await definition.resolveViewable(
      actor,
      current.resourceId,
      context(route, { commentId: id }),
    );
    const isAuthor = current.authorId === actor.id;
    if (!isAuthor) {
      await this.permissions.assertHasAll(
        actor,
        [PERMISSION.COMMENT_DELETE],
        context(route, { commentId: id }),
      );
    }

    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.delete(id, tx))) throw new AppException('COMMENT_NOT_FOUND');
      if (isAuthor) return;
      await this.audit.record(
        {
          action: 'comment.delete',
          resourceType: RESOURCE_TYPE.COMMENT,
          resourceId: id,
          resourceName: target.name,
          metadata: {
            targetType: current.resourceType,
            targetId: current.resourceId,
            authorId: current.authorId,
          },
        },
        tx,
      );
    });

    this.publish(definition, ChangeKind.DELETE, current);
  }

  /** @提及的候選：可以被提及、而且看得到這個資源的人（D6）。 */
  async mentionable(
    resourceType: string,
    resourceId: string,
    keyword: string,
    actor: AuthUser,
  ): Promise<MentionableListDto> {
    const definition = this.registry.require(resourceType);
    await definition.resolveViewable(
      actor,
      resourceId,
      context('GET /comments/:resourceType/:resourceId/mentionable', { resourceType, resourceId }),
    );
    const pool = await this.repo.searchMentionable(keyword, MENTION_SEARCH_POOL);
    const viewers = new Set(
      await definition.filterViewers(
        resourceId,
        pool.map((user) => user.id),
      ),
    );
    return {
      items: pool.filter((user) => viewers.has(user.id)).slice(0, MENTION_CANDIDATE_LIMIT),
    };
  }

  // ── 業務規則 ─────────────────────────────────────────

  /** 被提及的人要是 active 的一般使用者、而且看得到資源；不符的列在 `details.userIds`。 */
  private async assertMentionable(
    definition: CommentResourceDefinition,
    resourceId: string,
    ids: readonly string[],
  ): Promise<string[]> {
    if (!ids.length) return [];
    const active = await this.repo.findMentionable(ids);
    const viewers = new Set(await definition.filterViewers(resourceId, active));
    const invalid = ids.filter((id) => !viewers.has(id));
    if (invalid.length) throw new AppException('COMMENT_MENTION_INVALID', { userIds: invalid });
    return [...ids];
  }

  private async getExisting(id: string): Promise<CommentRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('COMMENT_NOT_FOUND');
    return row;
  }

  /** 不是作者卻要編輯：資源層級的拒絕，與 `PermissionService` 一樣寫 `authz.denied`（端點只宣告 `@Authenticated()`）。 */
  private async denyNotAuthor(
    actor: AuthUser,
    commentId: string,
    route: string,
  ): Promise<AppException> {
    const details = {
      resourceType: RESOURCE_TYPE.COMMENT,
      resourceId: commentId,
      reason: 'notAuthor',
    };
    await this.audit.recordSafely({
      action: 'authz.denied',
      result: 'failure',
      actorId: actor.id,
      actorEmail: actor.email,
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: { ...details, route },
    });
    return new AppException('AUTHZ_FORBIDDEN', details);
  }

  /** 不寫稽核的權限判斷：只決定畫面上要不要出現「刪除」，真正刪除時再以 `assertHasAll` 檢查。 */
  private async viewerOf(actor: AuthUser): Promise<Viewer> {
    const { permissions, isSuperAdmin } = await this.permissions.getPermissionSet(actor.id);
    return {
      id: actor.id,
      canModerate: isSuperAdmin || permissions.has(PERMISSION.COMMENT_DELETE),
    };
  }

  private async mentionedUsers(ids: readonly string[]): Promise<Map<string, CommentUser>> {
    const users = await this.repo.usersByIds([...new Set(ids)]);
    return new Map(users.map((user) => [user.id, user]));
  }

  /** 寫入之後回傳的一筆：作者是自己。 */
  private async single(row: CommentRow, actor: AuthUser): Promise<CommentDto> {
    const [self] = await this.repo.usersByIds([actor.id]);
    const withAuthor: CommentWithAuthor = {
      comment: row,
      author: self ?? null,
      createdAtExact: row.createdAt.toISOString(),
    };
    return toDto(withAuthor, await this.mentionedUsers(row.mentions), await this.viewerOf(actor));
  }

  /** 受眾是看得到所在資源的人：`refs` 帶那個資源（docs/architecture/backend/08-realtime.md §6.1）。 */
  private publish(definition: CommentResourceDefinition, kind: ChangeKind, row: CommentRow): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        {
          resource: ChangeSource.COMMENT,
          kind,
          id: row.id,
          refs: { [definition.changeSource]: [row.resourceId] },
        },
      ],
    });
  }
}

function context(route: string, metadata: Record<string, unknown>): PermissionCheckContext {
  return { route, metadata };
}

function paramsOf(
  resourceType: string,
  target: CommentTarget,
  body: string,
): CommentMentionedParams {
  return { resourceType, resourceName: target.name, excerpt: excerptOf(body) };
}

function toDto(
  { comment, author }: CommentWithAuthor,
  mentioned: ReadonlyMap<string, CommentUser>,
  viewer: Viewer,
): CommentDto {
  const isAuthor = comment.authorId === viewer.id;
  return {
    id: comment.id,
    resourceType: comment.resourceType,
    resourceId: comment.resourceId,
    body: comment.body,
    author,
    mentions: comment.mentions.flatMap((id) => mentioned.get(id) ?? []),
    version: comment.version,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
    canEdit: isAuthor,
    canDelete: isAuthor || viewer.canModerate,
  };
}
