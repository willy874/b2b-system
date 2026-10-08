import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { JobQueue } from '@/core/jobs';
import type { ApprovalRequestRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification, NotificationChannel } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';
import { WebhookService } from '@/modules/webhook/webhook.service';

import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { APPROVAL_RESULT_MAIL_JOB } from './approval-mail.constants';
import type { ApprovalType } from './approval.constants';
import { APPROVAL_RESULT_NOTIFICATION, approvalTaskLink } from './approval.notifications';
import { ApprovalRepository } from './approval.repository';
import type { ApprovalContext, ApprovalOutcome } from './approval.types';
import { APPROVAL_DECIDED_WEBHOOK } from './approval.webhooks';

/** 最終定案時附帶的內容。 */
export interface FinalDecision {
  reviewer: AuthUser;
  comment: string | null;
  /** 寫進 `approval.approve`／`approval.reject` 稽核的 `metadata`（例：多階段的關卡、停用期間的單關定案）。 */
  metadata?: Record<string, unknown>;
}

/**
 * 請求的 **最終** 核准與駁回（docs/architecture/backend/20-approval.md §3.4）：單關的核准、多階段的最後一關、
 * 停用期間的單關定案都走這裡，交易內的順序只有一份。呼叫端負責交易之前的檢查與交易之後的 `afterApply`、推播。
 */
@Injectable()
export class ApprovalFinalizer {
  constructor(
    private readonly repo: ApprovalRepository,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly audit: AuditService,
    private readonly jobs: JobQueue,
    private readonly notifications: NotificationService,
    private readonly webhooks: WebhookService,
  ) {}

  /**
   * 搶下請求再套用：條件式 UPDATE 只對仍為 `pending` 的列生效，併發的輸家在建立任何東西之前就 rollback。
   * 之後 `handler.apply`、寫回結果、稽核、結果信、通知申請人、對外事件，全部在同一個交易。
   */
  async approve(
    ctx: ApprovalContext,
    decision: FinalDecision,
    tx: Transaction,
  ): Promise<{ row: ApprovalRequestRow; outcome: ApprovalOutcome }> {
    const { request } = ctx;
    const handler = this.handlers.get(request.type);
    const row = await this.repo.review(
      request.id,
      {
        status: 'approved',
        reviewerId: decision.reviewer.id,
        reviewerName: decision.reviewer.email,
        reviewComment: decision.comment,
        reviewedAt: new Date(),
      },
      tx,
    );
    if (!row) throw new AppException('APPROVAL_ALREADY_REVIEWED');

    const outcome = await handler.apply(ctx, tx);
    await this.repo.setResult(request.id, outcome.resourceId, tx);
    await this.audit.record(
      {
        action: 'approval.approve',
        resourceType: 'approval',
        resourceId: request.id,
        resourceName: request.requesterName,
        changes: {
          before: { status: 'pending' },
          after: {
            status: 'approved',
            comment: decision.comment,
            roleIds: ctx.options.roleIds,
            resultResourceId: outcome.resourceId,
          },
        },
        ...(decision.metadata && { metadata: decision.metadata }),
      },
      tx,
    );
    await this.enqueueResultMail(request, tx);
    await this.notifyResult(request, 'approved', decision.reviewer, tx);
    await this.emitDecided(request, 'approved', tx);
    return { row: { ...row, resultResourceId: outcome.resourceId }, outcome };
  }

  async reject(
    request: ApprovalRequestRow,
    decision: FinalDecision,
    tx: Transaction,
  ): Promise<ApprovalRequestRow> {
    const row = await this.repo.review(
      request.id,
      {
        status: 'rejected',
        reviewerId: decision.reviewer.id,
        reviewerName: decision.reviewer.email,
        reviewComment: decision.comment,
        reviewedAt: new Date(),
      },
      tx,
    );
    if (!row) throw new AppException('APPROVAL_ALREADY_REVIEWED');
    await this.audit.record(
      {
        action: 'approval.reject',
        resourceType: 'approval',
        resourceId: request.id,
        resourceName: request.requesterName,
        changes: {
          before: { status: 'pending' },
          after: { status: 'rejected', comment: decision.comment },
        },
        ...(decision.metadata && { metadata: decision.metadata }),
      },
      tx,
    );
    await this.enqueueResultMail(request, tx);
    await this.notifyResult(request, 'rejected', decision.reviewer, tx);
    await this.emitDecided(request, 'rejected', tx);
    return row;
  }

  /**
   * 結果信是 `approval.result` 的 `email` 管道（docs/architecture/backend/16-notification-event.md §9.2 D3、D6、D14）：租戶關掉、或申請人自己關掉時不入列。
   * 匿名的申請（註冊）沒有帳號，只看租戶層。判斷的是入列當下的設定，已入列的信不撤回。
   */
  private async enqueueResultMail(request: ApprovalRequestRow, tx: Transaction): Promise<void> {
    const enabled = request.requesterId
      ? (
          await this.notifications.filterRecipients(
            APPROVAL_RESULT_NOTIFICATION,
            NotificationChannel.EMAIL,
            [request.requesterId],
            tx,
          )
        ).length > 0
      : await this.notifications.isChannelEnabled(
          APPROVAL_RESULT_NOTIFICATION,
          NotificationChannel.EMAIL,
          tx,
        );
    if (enabled) {
      await this.jobs.enqueue(APPROVAL_RESULT_MAIL_JOB, { approvalId: request.id }, { tx });
    }
  }

  /** 審批結果通知給申請人（docs/architecture/backend/15-notification.md §12.2 D11）；匿名的申請（註冊）沒有收件人，只有結果信。 */
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
        // 申請人通常沒有 approval:read：預設連到「我的審批」（docs/architecture/backend/20-approval.md §9.10）
        link: handler.resultLink ? handler.resultLink(request) : approvalTaskLink(request.id),
      }),
      tx,
    );
  }

  /** 對外事件 `approval.decided`（docs/architecture/backend/17-webhook.md §9.2 D2）。 */
  private emitDecided(
    request: ApprovalRequestRow,
    decision: 'approved' | 'rejected',
    tx: Transaction,
  ): Promise<void> {
    return this.webhooks.emit(
      APPROVAL_DECIDED_WEBHOOK,
      { approvalId: request.id, approvalType: request.type as ApprovalType, decision },
      tx,
    );
  }
}
