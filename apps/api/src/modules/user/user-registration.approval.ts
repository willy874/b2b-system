import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import type { Transaction } from '@/core/database';
import { ApprovalType } from '@/modules/approval/approval.constants';
import { ApprovalService } from '@/modules/approval/approval.service';
import type {
  ApprovalContext,
  ApprovalHandler,
  ApprovalOutcome,
  SubmitApprovalInput,
} from '@/modules/approval/approval.types';

import { UserService } from './user.service';

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
 * `user.register` 的核准：以申請時設定的密碼建立 **已啟用** 的帳號，並指派審核者選的角色
 * （docs/rbac/06-approval.md §5）。等同審核者代為「建立使用者」，所以要求相同的權限與檢查。
 */
@Injectable()
export class UserRegistrationApprovalHandler implements ApprovalHandler, OnModuleInit {
  readonly type = ApprovalType.USER_REGISTER;

  constructor(
    private readonly approvals: ApprovalService,
    private readonly users: UserService,
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
        // 申請人已設定密碼，核准即可登入，不再走啟用信
        status: 'active',
        roleIds: options.roleIds,
      },
      reviewer,
      tx,
      { approvalId: request.id },
    );
    return { resourceId: user.id };
  }

  async afterApply({ options }: ApprovalContext, { resourceId }: ApprovalOutcome): Promise<void> {
    if (resourceId) this.users.publishCreated(resourceId, options.roleIds);
  }
}
