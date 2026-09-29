import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { DEFAULT_MAIL_LOCALE, MailService, toMailLocale } from '@/core/mail';
import type { MailLocale } from '@/core/mail';
import type { ApprovalRequestRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';

import { APPROVAL_RESULT_MAIL_JOB } from './approval-mail.constants';
import type { ApprovalResultMailJobData } from './approval-mail.constants';
import { ApprovalType } from './approval.constants';
import { ApprovalRepository } from './approval.repository';
import { approvalResultMail } from './mails/approval-result.mail';

/** 核准後帶申請人去的頁面；沒列的類型回首頁。 */
const RESULT_PATH: Partial<Record<ApprovalType, string>> = {
  [ApprovalType.USER_REGISTER]: '/auth/login',
  [ApprovalType.FILE_FOLDER_ACCESS]: '/file',
};

interface Recipient {
  email: string;
  locale: MailLocale;
}

/** 審核結果通知申請人（docs/rbac/06-approval.md §6）。 */
@Injectable()
export class ApprovalResultMailJob implements OnModuleInit {
  private readonly logger = new Logger(ApprovalResultMailJob.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly repo: ApprovalRepository,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(APPROVAL_RESULT_MAIL_JOB, (data, ctx) => this.send(data, ctx));
  }

  async send(
    { approvalId }: ApprovalResultMailJobData,
    { id: jobId }: JobContext,
  ): Promise<{ messageId: string } | { skipped: string }> {
    const request = await this.repo.findById(approvalId);
    if (!request || request.status === 'pending') return { skipped: 'not_reviewed' };
    const recipient = await this.recipientOf(request);
    if (!recipient) return { skipped: 'no_recipient' };

    const approved = request.status === 'approved';
    const folderName = request.payload.folderName;
    const { messageId } = await this.mail.send(
      recipient.email,
      approvalResultMail({
        locale: recipient.locale,
        type: request.type,
        approved,
        subjectName: typeof folderName === 'string' ? folderName : null,
        comment: request.reviewComment,
        link: this.mail.link(approved ? (RESULT_PATH[request.type as ApprovalType] ?? '/') : '/'),
      }),
    );
    await this.audit.record({
      action: 'mail.send',
      resourceType: 'approval',
      resourceId: approvalId,
      resourceName: recipient.email,
      metadata: { template: 'approval.result', jobId, messageId },
    });
    this.logger.log({ approvalId, messageId }, '已寄出審核結果');
    return { messageId };
  }

  /**
   * 有帳號的申請人寄到帳號的 email（依他的語系）；匿名申請（註冊）寄到申請時填的 email，
   * 核准後帳號已建立，就用新帳號的語系。
   */
  private async recipientOf(request: ApprovalRequestRow): Promise<Recipient | undefined> {
    const userId =
      request.requesterId ??
      (request.type === ApprovalType.USER_REGISTER ? request.resultResourceId : null);
    const user = userId ? await this.repo.findRecipient(userId) : undefined;
    if (user) return { email: user.email, locale: toMailLocale(user.locale) };
    // 申請人的帳號已刪除：不寄
    if (request.requesterId) return undefined;
    return request.type === ApprovalType.USER_REGISTER
      ? { email: request.requesterName, locale: DEFAULT_MAIL_LOCALE }
      : undefined;
  }
}
