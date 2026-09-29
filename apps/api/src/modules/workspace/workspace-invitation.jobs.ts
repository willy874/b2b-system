import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { MailService, toMailLocale } from '@/core/mail';
import { AuditService } from '@/modules/audit-log/audit.service';
import { sha256 } from '@/modules/auth/token-hash';
import { UserService } from '@/modules/user/user.service';

import { workspaceInvitationMail } from './mails/workspace-invitation.mail';
import {
  WORKSPACE_INVITATION_MAIL_JOB,
  WORKSPACE_INVITATION_PATH,
  WORKSPACE_INVITATION_TTL_SECONDS,
} from './workspace-invitation.constants';
import type { WorkspaceInvitationMailJobData } from './workspace-invitation.constants';
import { WorkspaceInvitationRepository } from './workspace-invitation.repository';

/** 邀請信的背景工作；`WorkspaceInvitationService` 入列，這裡寄出。 */
@Injectable()
export class WorkspaceInvitationJobs implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceInvitationJobs.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly repo: WorkspaceInvitationRepository,
    private readonly users: UserService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(WORKSPACE_INVITATION_MAIL_JOB, (data, ctx) => this.send(data, ctx));
  }

  async send(
    { invitationId }: WorkspaceInvitationMailJobData,
    { id: jobId }: JobContext,
  ): Promise<{ messageId: string } | { skipped: string }> {
    // 入列之後可能已經被撤銷、接受，或工作區被刪除（刪除的工作區查不到）
    const invitation = await this.repo.findForMail(invitationId);
    if (!invitation) return { skipped: 'invitation_not_found' };
    if (invitation.acceptedAt) return { skipped: 'invitation_accepted' };
    if (invitation.revokedAt) return { skipped: 'invitation_revoked' };

    // 已有帳號用本人的語系；沒有的話用邀請人的（多半同一個團隊）
    const account = await this.users.findAccountByEmail(invitation.email);
    const locale = toMailLocale(account?.locale ?? invitation.inviter?.locale);

    // 每次寄出都簽新的並重新起算期限：重試時前一封的連結跟著失效，信箱裡只有最後一封能用
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + WORKSPACE_INVITATION_TTL_SECONDS * 1000);
    await this.repo.setToken(invitation.id, sha256(raw), expiresAt);

    const { messageId } = await this.mail.send(
      invitation.email,
      workspaceInvitationMail({
        locale,
        workspaceName: invitation.workspace.name,
        inviterName: invitation.inviter?.displayName ?? null,
        link: this.mail.link(WORKSPACE_INVITATION_PATH, { token: raw }),
        validDays: WORKSPACE_INVITATION_TTL_SECONDS / 86_400,
      }),
    );
    // 只記「寄了哪一種信給誰」，不記內容與 token（docs/adr/0017-mail-delivery.md D8）
    await this.audit.record({
      action: 'mail.send',
      resourceType: 'workspaceInvitation',
      resourceId: invitation.id,
      resourceName: invitation.email,
      metadata: {
        template: 'workspace.invitation',
        jobId,
        messageId,
        workspaceId: invitation.workspaceId,
      },
    });
    this.logger.log({ invitationId, messageId }, '已寄出邀請信');
    return { messageId };
  }
}
