import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, constraintNameOf, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { JobQueue } from '@/core/jobs';
import type { ApprovalRequestRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification, NotificationChannel } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { PermissionService } from '@/modules/permission/permission.service';

import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_RESULT_MAIL_JOB } from './approval-mail.constants';
import { APPROVAL_PERMISSIONS, PENDING_SUBJECT_CONSTRAINT } from './approval.constants';
import type { ApprovalType } from './approval.constants';
import {
  APPROVAL_PENDING_NOTIFICATION,
  APPROVAL_RESULT_NOTIFICATION,
  approvalDetailLink,
} from './approval.notifications';
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
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ApprovalRepository,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly jobs: JobQueue,
    private readonly notifications: NotificationService,
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
    const handler = this.handlers.get(input.type);
    // 審核者是送出當下的快照（ADR-0026 D5）：之後權限變動不補發也不收回
    const reviewers = await this.permissionService.findActiveUserIdsWithPermission(
      APPROVAL_PERMISSIONS.REVIEW,
    );

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
        // 申請人自己也有審核權限時不通知他（操作者＝收件人，D7）；匿名的註冊沒有操作者
        await this.notifications.notify(
          reviewers.map((recipientId) =>
            notification(APPROVAL_PENDING_NOTIFICATION, {
              recipientId,
              actorId: input.requester.id,
              params: {
                approvalType: input.type,
                requesterName: input.requester.name,
                subject: handler.summarize(input.payload),
              },
              link: approvalDetailLink(row.id),
            }),
          ),
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
      await this.enqueueResultMail(id, tx);
      await this.notifyResult(request, 'approved', reviewer, tx);
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
      await this.enqueueResultMail(id, tx);
      await this.notifyResult(request, 'rejected', reviewer, tx);
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

  /**
   * 結果信是 `approval.result` 的 `email` 管道（ADR-0028 D3、D6）：租戶關掉時不入列。
   * 判斷的是入列當下的政策，已入列的信不撤回。
   */
  private async enqueueResultMail(approvalId: string, tx: Transaction): Promise<void> {
    const enabled = await this.notifications.isChannelEnabled(
      APPROVAL_RESULT_NOTIFICATION,
      NotificationChannel.EMAIL,
      tx,
    );
    if (enabled) await this.jobs.enqueue(APPROVAL_RESULT_MAIL_JOB, { approvalId }, { tx });
  }

  /** 審批結果通知給申請人（ADR-0026 D11）；匿名的申請（註冊）沒有收件人，只有結果信。 */
  private async notifyResult(
    request: ApprovalRequestRow,
    status: 'approved' | 'rejected',
    reviewer: AuthUser,
    tx: Transaction,
  ): Promise<void> {
    if (!request.requesterId) return;
    const handler = this.handlers.get(request.type);
    await this.notifications.notify(
      notification(APPROVAL_RESULT_NOTIFICATION, {
        recipientId: request.requesterId,
        actorId: reviewer.id,
        params: {
          approvalType: request.type as ApprovalType,
          subject: handler.summarize(request.payload),
          status,
        },
        link: handler.resultLink ? handler.resultLink(request) : approvalDetailLink(request.id),
      }),
      tx,
    );
  }

  private publishChanged(id: string, kind: ChangeKind): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.APPROVAL, kind, id }],
    });
  }
}
