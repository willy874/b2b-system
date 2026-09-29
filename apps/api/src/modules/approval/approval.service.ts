import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException, constraintNameOf, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import type { ApprovalRequestRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { PENDING_SUBJECT_CONSTRAINT } from './approval.constants';
import type { ApprovalType } from './approval.constants';
import { ApprovalRepository } from './approval.repository';
import type { ApprovalContext, ApprovalHandler, SubmitApprovalInput } from './approval.types';
import type {
  ApprovalRequestDto,
  ApproveApprovalDto,
  ListApprovalDto,
  RejectApprovalDto,
} from './dto/approval.dto';

function toDto(row: ApprovalRequestRow): ApprovalRequestDto {
  return {
    id: row.id,
    type: row.type as ApprovalType,
    status: row.status,
    payload: row.payload,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    reason: row.reason,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    resultResourceId: row.resultResourceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 審批請求的狀態機：`pending` → `approved` | `rejected`，只能走一次（docs/rbac/06-approval.md §3）。
 * 「核准之後做什麼」交給各類型的 `ApprovalHandler`；這裡負責權限、交易、稽核與推播。
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: ApprovalRepository,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  /** 擁有資源的模組在 `onModuleInit` 呼叫，登記自己負責的審批類型。 */
  registerHandler(handler: ApprovalHandler): void {
    this.handlers.register(handler);
  }

  /**
   * 建立一筆待審請求。同類型同對象已有待審請求時不再建立，回傳 `undefined`——
   * 要不要把「重複」告訴申請人由呼叫端決定（註冊為了防帳號列舉而不說）。
   */
  async submit(input: SubmitApprovalInput): Promise<ApprovalRequestDto | undefined> {
    if (await this.repo.findPending(input.type, input.subjectKey)) return undefined;

    let created: ApprovalRequestRow;
    try {
      created = await withTransaction(this.db, async (tx) => {
        const row = await this.repo.create(
          {
            type: input.type,
            subjectKey: input.subjectKey,
            payload: input.payload,
            privatePayload: input.privatePayload ?? null,
            requesterId: input.requester.id,
            requesterName: input.requester.name,
            reason: input.reason ?? null,
          },
          tx,
        );
        await this.audit.record(
          {
            action: 'approval.submit',
            resourceType: 'approval',
            resourceId: row.id,
            resourceName: input.requester.name,
            actorId: input.requester.id,
            actorEmail: input.requester.name,
            // private_payload 永不進稽核
            changes: { after: { type: input.type, payload: input.payload } },
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      // 預檢查與 INSERT 之間被併發的同一筆搶先：結果等同「已有待審」
      if (isUniqueViolation(error) && constraintNameOf(error) === PENDING_SUBJECT_CONSTRAINT) {
        return undefined;
      }
      throw error;
    }

    this.publishChanged(created.id, ChangeKind.CREATE);
    return toDto(created);
  }

  async list(query: ListApprovalDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(items.map(toDto), total, query);
  }

  /** 某類型的待審請求（依去重鍵前綴或申請人篩選）；讀取權限由呼叫端決定。 */
  async listPendingBy(
    type: ApprovalType,
    filter: { subjectKeyPrefix?: string; requesterId?: string },
  ): Promise<ApprovalRequestDto[]> {
    return (await this.repo.findPendingBy(type, filter)).map(toDto);
  }

  async findOne(id: string): Promise<ApprovalRequestDto> {
    return toDto(await this.getExisting(id));
  }

  async approve(
    id: string,
    dto: ApproveApprovalDto,
    reviewer: AuthUser,
  ): Promise<ApprovalRequestDto> {
    const request = await this.getPending(id, reviewer);
    const handler = this.handlers.get(request.type);
    const ctx: ApprovalContext = { request, reviewer, options: { roleIds: dto.roleIds } };

    await this.assertPermissions(reviewer.id, handler.requiredPermissions(ctx));
    await handler.assertApprovable(ctx);

    const { reviewed, outcome } = await withTransaction(this.db, async (tx) => {
      // 先搶下請求再套用：併發核准時，輸的那個在建立任何東西之前就 rollback
      const row = await this.repo.review(
        id,
        {
          status: 'approved',
          reviewerId: reviewer.id,
          reviewerName: reviewer.email,
          reviewComment: dto.comment ?? null,
          reviewedAt: new Date(),
        },
        tx,
      );
      if (!row) throw new AppException('APPROVAL_ALREADY_REVIEWED');

      const applied = await handler.apply(ctx, tx);
      await this.repo.setResult(id, applied.resourceId, tx);
      await this.audit.record(
        {
          action: 'approval.approve',
          resourceType: 'approval',
          resourceId: id,
          resourceName: request.requesterName,
          changes: {
            before: { status: 'pending' },
            after: {
              status: 'approved',
              comment: dto.comment ?? null,
              roleIds: dto.roleIds,
              resultResourceId: applied.resourceId,
            },
          },
        },
        tx,
      );
      return { reviewed: { ...row, resultResourceId: applied.resourceId }, outcome: applied };
    });

    await handler.afterApply(ctx, outcome);
    this.publishChanged(id, ChangeKind.UPDATE);
    return toDto(reviewed);
  }

  async reject(
    id: string,
    dto: RejectApprovalDto,
    reviewer: AuthUser,
  ): Promise<ApprovalRequestDto> {
    const request = await this.getPending(id, reviewer);

    const reviewed = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.review(
        id,
        {
          status: 'rejected',
          reviewerId: reviewer.id,
          reviewerName: reviewer.email,
          reviewComment: dto.comment ?? null,
          reviewedAt: new Date(),
        },
        tx,
      );
      if (!row) throw new AppException('APPROVAL_ALREADY_REVIEWED');
      await this.audit.record(
        {
          action: 'approval.reject',
          resourceType: 'approval',
          resourceId: id,
          resourceName: request.requesterName,
          changes: {
            before: { status: 'pending' },
            after: { status: 'rejected', comment: dto.comment ?? null },
          },
        },
        tx,
      );
      return row;
    });

    this.publishChanged(id, ChangeKind.UPDATE);
    return toDto(reviewed);
  }

  // ── 業務規則 ─────────────────────────────────────────────

  private async getExisting(id: string): Promise<ApprovalRequestRow> {
    const request = await this.repo.findById(id);
    if (!request) throw new AppException('APPROVAL_NOT_FOUND');
    return request;
  }

  private async getPending(id: string, reviewer: AuthUser): Promise<ApprovalRequestRow> {
    const request = await this.getExisting(id);
    if (request.status !== 'pending') throw new AppException('APPROVAL_ALREADY_REVIEWED');
    // 四眼原則：自己送出的請求要由別人審
    if (request.requesterId === reviewer.id) throw new AppException('APPROVAL_SELF_REVIEW');
    return request;
  }

  /** 與 `PermissionsGuard` 相同的回應形狀：`AUTHZ_FORBIDDEN` ＋ 缺少的權限。 */
  private async assertPermissions(userId: string, keys: readonly PermissionKey[]): Promise<void> {
    if (!keys.length) return;
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(userId);
    if (isSuperAdmin) return;
    const missing = keys.filter((key) => !permissions.has(key));
    if (missing.length) throw new AppException('AUTHZ_FORBIDDEN', { missing });
  }

  private publishChanged(id: string, kind: ChangeKind): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.APPROVAL, kind, id }],
    });
  }
}
