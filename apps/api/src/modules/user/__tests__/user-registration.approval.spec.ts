import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { JobQueue } from '@/core/jobs';
import type { ApprovalRequestRow } from '@/db/schema';
import type { ApprovalService } from '@/modules/approval/approval.service';
import type { ApprovalContext } from '@/modules/approval/approval.types';

import type { UserAccountService } from '../user-account.service';
import {
  UserRegistrationApprovalHandler,
  userRegistrationRequest,
} from '../user-registration.approval';

const REVIEWER: AuthUser = { id: 'reviewer-1', email: 'reviewer@example.com', status: 'active' };

function context(roleIds: string[] = []): ApprovalContext {
  const input = userRegistrationRequest({
    email: 'Alice@Example.com',
    displayName: 'Alice',
    reason: '新進企劃',
  });
  return {
    request: {
      id: 'approval-1',
      type: input.type,
      status: 'pending',
      subjectKey: input.subjectKey,
      payload: input.payload,
      privatePayload: input.privatePayload ?? null,
      requesterId: null,
      requesterName: input.requester.name,
      reason: input.reason ?? null,
    } as ApprovalRequestRow,
    reviewer: REVIEWER,
    options: { roleIds },
  };
}

function setup() {
  const users = {
    assertCreatable: vi.fn(async () => undefined),
    createAccount: vi.fn(async () => ({ id: 'user-9' })),
    publishCreated: vi.fn(),
  };
  const approvals = { registerHandler: vi.fn() };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const handler = new UserRegistrationApprovalHandler(
    approvals as unknown as ApprovalService,
    users as unknown as UserAccountService,
    jobs as unknown as JobQueue,
  );
  return { handler, users, approvals, jobs };
}

describe('userRegistrationRequest', () => {
  it('去重鍵是小寫 email；不帶任何密碼', () => {
    const input = userRegistrationRequest({ email: 'Alice@Example.com', displayName: 'Alice' });
    expect(input).toMatchObject({
      type: 'user.register',
      subjectKey: 'alice@example.com',
      payload: { email: 'Alice@Example.com', displayName: 'Alice' },
      requester: { id: null, name: 'Alice@Example.com' },
    });
    expect(input.privatePayload).toBeUndefined();
  });
});

describe('UserRegistrationApprovalHandler（docs/rbac/06-approval.md §5）', () => {
  it('啟動時把自己註冊進審批服務', () => {
    const { handler, approvals } = setup();
    handler.onModuleInit();
    expect(approvals.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('不指派角色時只需要 user:create；指派角色時另需 user:assignRole', () => {
    const { handler } = setup();
    expect(handler.requiredPermissions(context())).toEqual(['user:create']);
    expect(handler.requiredPermissions(context(['role-1']))).toEqual([
      'user:create',
      'user:assignRole',
    ]);
  });

  it('核准前的檢查與建立使用者相同（email 可用、角色可指派）', async () => {
    const { handler, users } = setup();
    await handler.assertApprovable(context(['role-1']));
    expect(users.assertCreatable).toHaveBeenCalledWith('Alice@Example.com', ['role-1'], REVIEWER);
  });

  it('建立未啟用（pending）的帳號，稽核帶上審批 id（email 還沒驗證）', async () => {
    const { handler, users } = setup();
    const tx = {} as never;
    await expect(handler.apply(context(['role-1']), tx)).resolves.toEqual({ resourceId: 'user-9' });
    expect(users.createAccount).toHaveBeenCalledWith(
      {
        email: 'Alice@Example.com',
        displayName: 'Alice',
        status: 'pending',
        roleIds: ['role-1'],
      },
      REVIEWER,
      tx,
      { approvalId: 'approval-1' },
    );
  });

  it('在同一個交易內入列啟用信：要從申請的信箱完成啟用才能登入', async () => {
    const { handler, jobs } = setup();
    const tx = {} as never;
    await handler.apply(context(), tx);
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'auth.activationMail' }),
      { userId: 'user-9' },
      { tx },
    );
  });

  it('交易提交後推播新使用者（帶上指派的角色）', async () => {
    const { handler, users } = setup();
    await handler.afterApply(context(['role-1']), { resourceId: 'user-9' });
    expect(users.publishCreated).toHaveBeenCalledWith('user-9', ['role-1']);
  });
});
