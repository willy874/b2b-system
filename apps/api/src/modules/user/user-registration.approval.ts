import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import type { Transaction } from '@/core/database';
import { JobQueue } from '@/core/jobs';
import { ApprovalType } from '@/modules/approval/approval.constants';
import { ApprovalService } from '@/modules/approval/approval.service';
import type {
  ApprovalContext,
  ApprovalHandler,
  ApprovalOutcome,
  SubmitApprovalInput,
} from '@/modules/approval/approval.types';
import { ACTIVATION_MAIL_JOB } from '@/modules/credential/auth-mail.constants';

import { UserAccountService } from './user-account.service';

/** 審核者看得到的註冊內容。 */
const RegistrationPayloadSchema = z.object({
  email: z.string(),
  displayName: z.string(),
});

/** 申請人設定的密碼（argon2 雜湊）；審核後由 `ApprovalRepository.review()` 清空。 */
const RegistrationSecretSchema = z.object({ passwordHash: z.string() });

export interface Registration {
  email: string;
  displayName: string;
  reason?: string | null;
}

/** 註冊申請 → 一筆 `user.register` 審批請求（`AuthService.register` 用）。 */
export function userRegistrationRequest(
  registration: Registration,
  passwordHash: string,
): SubmitApprovalInput {
  return {
    type: ApprovalType.USER_REGISTER,
    // users.email 是 citext：去重鍵也要不分大小寫
    subjectKey: registration.email.toLowerCase(),
    payload: { email: registration.email, displayName: registration.displayName },
    privatePayload: { passwordHash },
    requester: { id: null, name: registration.email },
    reason: registration.reason ?? null,
  };
}

/**
 * `user.register` 的核准：建立 **未啟用**（`pending`）的帳號並指派審核者選的角色，同一個交易內入列啟用信
 * （docs/rbac/06-approval.md §5）。等同審核者代為「建立使用者」，所以要求相同的權限與檢查。
 *
 * 申請時沒有驗證 email：任何人都能以別人的 email 申請。核准後要由那個信箱收到的啟用信設定密碼才會啟用，
 * 證明申請人真的擁有這個 email。申請時設定的密碼先存著，
 * 啟用前以它登入會得到 `AUTH_ACCOUNT_PENDING`（提示去收信），而不是「帳密錯誤」。
 */
@Injectable()
export class UserRegistrationApprovalHandler implements ApprovalHandler, OnModuleInit {
  readonly type = ApprovalType.USER_REGISTER;

  constructor(
    private readonly approvals: ApprovalService,
    private readonly users: UserAccountService,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler(this);
  }

  requiredPermissions({ options }: ApprovalContext): PermissionKey[] {
    return options.roleIds.length
      ? [PERMISSION.USER_CREATE, PERMISSION.USER_ASSIGN_ROLE]
      : [PERMISSION.USER_CREATE];
  }

  async assertApprovable({ request, reviewer, options }: ApprovalContext): Promise<void> {
    const payload = RegistrationPayloadSchema.parse(request.payload);
    // 申請之後才被管理員直接建立的同 email 帳號 → USER_EMAIL_DUPLICATE，審核者改為駁回
    await this.users.assertCreatable(payload.email, options.roleIds, reviewer);
  }

  async apply(
    { request, reviewer, options }: ApprovalContext,
    tx: Transaction,
  ): Promise<ApprovalOutcome> {
    const payload = RegistrationPayloadSchema.parse(request.payload);
    const secret = RegistrationSecretSchema.parse(request.privatePayload);
    const user = await this.users.createAccount(
      {
        email: payload.email,
        displayName: payload.displayName,
        passwordHash: secret.passwordHash,
        status: 'pending',
        roleIds: options.roleIds,
      },
      reviewer,
      tx,
      { approvalId: request.id },
    );
    // 與帳號同生共死：核准失敗就不會寄出啟用信（docs/architecture/backend/11-mail.md §4）
    await this.jobs.enqueue(ACTIVATION_MAIL_JOB, { userId: user.id }, { tx });
    return { resourceId: user.id };
  }

  async afterApply({ options }: ApprovalContext, { resourceId }: ApprovalOutcome): Promise<void> {
    if (resourceId) await this.users.publishCreated(resourceId, options.roleIds);
  }

  /** 審核者看到的「誰申請」：申請人填的顯示名稱（email 已在 `requesterName`）。 */
  summarize(payload: Record<string, unknown>): string {
    const parsed = RegistrationPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.displayName : '';
  }
}
