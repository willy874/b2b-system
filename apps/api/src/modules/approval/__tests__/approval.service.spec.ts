import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { ApprovalRequestRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationService } from '@/modules/notification/notification.service';
import { createPermissionChecks } from '@/modules/permission/__tests__/permission-checks.fixture';
import type { WebhookService } from '@/modules/webhook/webhook.service';

import { ApprovalAssigneeRegistry } from '../approval-assignee.registry';
import type { ApprovalChainRepository } from '../approval-chain.repository';
import type { ApprovalChainService } from '../approval-chain.service';
import { ApprovalFinalizer } from '../approval-finalizer.service';
import { ApprovalHandlerRegistry } from '../approval-handler.registry';
import { ApprovalType, PENDING_SUBJECT_CONSTRAINT } from '../approval.constants';
import type { ApprovalRepository } from '../approval.repository';
import { ApprovalService } from '../approval.service';
import type { ApprovalHandler, SubmitApprovalInput } from '../approval.types';

const REVIEWER: AuthUser = { id: 'reviewer-1', email: 'reviewer@example.com', status: 'active' };

function row(overrides: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow {
  return {
    id: 'approval-1',
    type: ApprovalType.USER_REGISTER,
    status: 'pending',
    subjectKey: 'alice@example.com',
    payload: { email: 'alice@example.com', displayName: 'Alice' },
    privatePayload: { passwordHash: 'hash' },
    requesterId: null,
    requesterName: 'alice@example.com',
    reason: null,
    reviewerId: null,
    reviewerName: null,
    reviewComment: null,
    reviewedAt: null,
    resultResourceId: null,
    flowId: null,
    flowVersion: null,
    allowRepeatApprover: null,
    currentStep: null,
    resubmittedFrom: null,
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
    updatedAt: new Date('2026-09-25T00:00:00.000Z'),
    ...overrides,
  };
}

const SUBMIT: SubmitApprovalInput = {
  type: ApprovalType.USER_REGISTER,
  subjectKey: 'alice@example.com',
  payload: { email: 'alice@example.com', displayName: 'Alice' },
  privatePayload: { passwordHash: 'hash' },
  requester: { id: null, name: 'alice@example.com' },
};

function setup(permissionSet: PermissionSet = { permissions: new Set(), isSuperAdmin: true }) {
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    create: vi.fn(async (values: Partial<ApprovalRequestRow>) => row(values)),
    findById: vi.fn(async (): Promise<ApprovalRequestRow | undefined> => row()),
    findPending: vi.fn(async (): Promise<ApprovalRequestRow | undefined> => undefined),
    list: vi.fn(),
    count: vi.fn(async () => 0),
    review: vi.fn(
      async (
        _id: string,
        values: Partial<ApprovalRequestRow>,
      ): Promise<ApprovalRequestRow | undefined> => row({ ...values, privatePayload: null }),
    ),
    setResult: vi.fn(async () => undefined),
  };
  // 真的權限判斷（拒絕時寫 authz.denied）；getPermissionSet 回傳這個案例的集合
  const { service: permissionService, audit: denials } = createPermissionChecks(
    () => permissionSet,
  );
  vi.spyOn(permissionService, 'findActiveUserIdsWithPermission').mockResolvedValue([
    'reviewer-1',
    'reviewer-2',
  ]);
  const notifications = {
    notify: vi.fn(async () => []),
    isChannelEnabled: vi.fn(async () => true),
    filterRecipients: vi.fn(async (_kind: unknown, _channel: string, ids: string[]) => ids),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const jobs = { enqueue: vi.fn(async () => 'job-1') };
  const webhooks = { emit: vi.fn(async () => undefined) };
  const handler = {
    type: ApprovalType.USER_REGISTER,
    requiredPermissions: vi.fn((): PermissionKey[] => ['user:create']),
    assertApprovable: vi.fn(async () => undefined),
    apply: vi.fn(async () => ({ resourceId: 'user-9' })),
    afterApply: vi.fn(async () => undefined),
    summarize: vi.fn(() => 'Alice'),
  } satisfies ApprovalHandler;

  // 單關的情境：沒有流程，多階段的部分以假物件代替（多階段的規則在 approval-chain.service.spec.ts）
  const chainRepo = {
    summariesOf: vi.fn(async () => ({ current: new Map(), counts: new Map() })),
    stepsOf: vi.fn(async () => []),
    assigneeIdsOf: vi.fn(async () => []),
  };
  const chain = {
    flowFor: vi.fn(async () => undefined),
    isEnabled: vi.fn(() => true),
    overrideHolders: vi.fn(async () => []),
    canView: vi.fn(async () => true),
    closeByLegacy: vi.fn(async () => undefined),
  };
  const handlers = new ApprovalHandlerRegistry();
  const finalizer = new ApprovalFinalizer(
    repo as unknown as ApprovalRepository,
    handlers,
    audit as unknown as AuditService,
    jobs as unknown as JobQueue,
    notifications as unknown as NotificationService,
    webhooks as unknown as WebhookService,
  );
  const service = new ApprovalService(
    db as never,
    repo as unknown as ApprovalRepository,
    chainRepo as unknown as ApprovalChainRepository,
    handlers,
    new ApprovalAssigneeRegistry(),
    chain as unknown as ApprovalChainService,
    finalizer,
    permissionService,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    notifications as unknown as NotificationService,
  );
  service.registerHandler(handler);
  return {
    service,
    chain,
    repo,
    audit,
    events,
    handler,
    tx,
    jobs,
    notifications,
    permissionService,
    denials,
    webhooks,
  };
}

async function expectCode(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toBeInstanceOf(AppException);
  await expect(operation).rejects.toMatchObject({ code });
}

describe('ApprovalService.submit', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('建立待審請求，稽核不含 private_payload，並推播 approval.create', async () => {
    const created = await ctx.service.submit(SUBMIT);

    expect(created).toMatchObject({ status: 'pending', requesterName: 'alice@example.com' });
    expect(created).not.toHaveProperty('privatePayload');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approval.submit', actorId: null }),
      ctx.tx,
    );
    expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain('passwordHash');
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'approval', kind: 'create', id: 'approval-1' }],
      affectedUserIds: [],
    });
  });

  it('在同一個交易內通知送出當下持有 approval:review 的人（docs/architecture/backend/15-notification.md §12.2 D5、D11）', async () => {
    await ctx.service.submit({ ...SUBMIT, requester: { id: 'member-1', name: 'm@example.com' } });

    expect(ctx.permissionService.findActiveUserIdsWithPermission).toHaveBeenCalledWith(
      'approval:review',
    );
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      ['reviewer-1', 'reviewer-2'].map((recipientId) => ({
        type: 'approval.pending',
        recipientId,
        // 申請人自己也有審核權限時由 notify 略過（操作者＝收件人）
        actorId: 'member-1',
        params: { approvalType: 'user.register', requesterName: 'm@example.com', subject: 'Alice' },
        link: { route: 'approval.detail', params: { approvalId: 'approval-1' } },
      })),
      ctx.tx,
    );
    expect(ctx.handler.summarize).toHaveBeenCalledWith(SUBMIT.payload);
  });

  it('同對象已有待審請求 → 不建立、回傳 undefined，也不通知', async () => {
    ctx.repo.findPending.mockResolvedValueOnce(row());
    await expect(ctx.service.submit(SUBMIT)).resolves.toBeUndefined();
    expect(ctx.repo.create).not.toHaveBeenCalled();
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('併發送出撞到待審唯一索引 → 視同已有待審', async () => {
    ctx.repo.create.mockRejectedValueOnce({
      cause: { code: '23505', constraint_name: PENDING_SUBJECT_CONSTRAINT },
    });
    await expect(ctx.service.submit(SUBMIT)).resolves.toBeUndefined();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('其他錯誤照常拋出', async () => {
    ctx.repo.create.mockRejectedValueOnce(new Error('boom'));
    await expect(ctx.service.submit(SUBMIT)).rejects.toThrow('boom');
  });
});

describe('ApprovalService.approve', () => {
  it('成功：先搶下請求、交易內套用並記錄結果，提交後才跑 afterApply 與推播', async () => {
    const ctx = setup();
    const result = await ctx.service.approve(
      'approval-1',
      { roleIds: ['role-1'], comment: 'ok' },
      REVIEWER,
    );

    expect(result).toMatchObject({
      status: 'approved',
      reviewerName: REVIEWER.email,
      reviewComment: 'ok',
      resultResourceId: 'user-9',
    });
    expect(ctx.handler.apply).toHaveBeenCalledWith(
      expect.objectContaining({ reviewer: REVIEWER, options: { roleIds: ['role-1'] } }),
      ctx.tx,
    );
    expect(ctx.repo.setResult).toHaveBeenCalledWith('approval-1', 'user-9', ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approval.approve' }),
      ctx.tx,
    );
    expect(ctx.handler.afterApply).toHaveBeenCalledWith(expect.anything(), {
      resourceId: 'user-9',
    });
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'approval', kind: 'update', id: 'approval-1' }],
      affectedUserIds: [],
    });
    const reviewOrder = ctx.repo.review.mock.invocationCallOrder[0]!;
    expect(reviewOrder).toBeLessThan(ctx.handler.apply.mock.invocationCallOrder[0]!);
  });

  it('審核結果通知在同一個交易內入列', async () => {
    const ctx = setup();
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'approval.resultMail' }),
      { approvalId: 'approval-1' },
      { tx: ctx.tx },
    );
  });

  it('有帳號的申請人自己關掉結果信 → 不入列（docs/architecture/backend/16-notification-event.md §9.2 D14）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ requesterId: 'member-1' }));
    ctx.notifications.filterRecipients.mockResolvedValue([]);
    await ctx.service.reject('approval-1', {}, REVIEWER);
    expect(ctx.notifications.filterRecipients).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.result' }),
      'email',
      ['member-1'],
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('租戶關掉 approval.result 的 email 管道 → 不入列結果信（docs/architecture/backend/16-notification-event.md §9.2 D3）', async () => {
    const ctx = setup();
    ctx.notifications.isChannelEnabled.mockResolvedValue(false);
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.notifications.isChannelEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.result' }),
      'email',
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('匿名的申請（註冊）沒有收件人：不寫審批結果通知', async () => {
    const ctx = setup();
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });

  it('有申請人：在同一個交易內通知申請人核准結果，連到「我的審批」（申請人通常沒有 approval:read）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ requesterId: 'member-1' }));
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      {
        type: 'approval.result',
        recipientId: 'member-1',
        actorId: REVIEWER.id,
        params: { approvalType: 'user.register', subject: 'Alice', status: 'approved' },
        link: { route: 'approval.myDetail', params: { approvalId: 'approval-1' } },
      },
      ctx.tx,
    );
  });

  it('在同一個交易內發出對外事件 approval.decided（docs/architecture/backend/17-webhook.md §9.2 D2）', async () => {
    const ctx = setup();
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.webhooks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.decided' }),
      { approvalId: 'approval-1', approvalType: 'user.register', decision: 'approved' },
      ctx.tx,
    );
  });

  it('handler 提供 resultLink 時結果通知用它的連結', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ requesterId: 'member-1' }));
    const link = { route: 'file.folder', params: { folderId: 'f1' } };
    Object.assign(ctx.handler, { resultLink: vi.fn(() => link) });
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.result', link }),
      ctx.tx,
    );
  });

  it('找不到 → APPROVAL_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(undefined);
    await expectCode(
      ctx.service.approve('missing', { roleIds: [] }, REVIEWER),
      'APPROVAL_NOT_FOUND',
    );
  });

  it('已審核過 → APPROVAL_ALREADY_REVIEWED', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ status: 'rejected', reviewedAt: new Date() }));
    await expectCode(
      ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER),
      'APPROVAL_ALREADY_REVIEWED',
    );
  });

  it('審自己送出的請求 → APPROVAL_SELF_REVIEW', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ requesterId: REVIEWER.id }));
    await expectCode(
      ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER),
      'APPROVAL_SELF_REVIEW',
    );
  });

  it('缺少 handler 要求的權限 → AUTHZ_FORBIDDEN { required, missing }、寫 authz.denied，不寫入任何東西', async () => {
    const ctx = setup({ permissions: new Set(['approval:review']), isSuperAdmin: false });
    const operation = ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    await expect(operation).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { required: ['user:create'], missing: ['user:create'] },
    });
    expect(ctx.denials.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        actorId: REVIEWER.id,
        metadata: {
          approvalId: 'approval-1',
          type: ApprovalType.USER_REGISTER,
          route: 'POST /approvals/:id/approve',
          required: ['user:create'],
          missing: ['user:create'],
        },
      }),
    );
    expect(ctx.repo.review).not.toHaveBeenCalled();
  });

  it('持有 handler 要求的權限即可核准', async () => {
    const ctx = setup({
      permissions: new Set<PermissionKey>(['approval:review', 'user:create']),
      isSuperAdmin: false,
    });
    await expect(
      ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER),
    ).resolves.toMatchObject({ status: 'approved' });
  });

  it('handler 的業務檢查失敗 → 原樣拋出，不寫入任何東西', async () => {
    const ctx = setup();
    ctx.handler.assertApprovable.mockRejectedValueOnce(new AppException('USER_EMAIL_DUPLICATE'));
    await expectCode(
      ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER),
      'USER_EMAIL_DUPLICATE',
    );
    expect(ctx.repo.review).not.toHaveBeenCalled();
  });

  it('併發核准時沒搶到 → APPROVAL_ALREADY_REVIEWED，且不套用變更', async () => {
    const ctx = setup();
    ctx.repo.review.mockResolvedValueOnce(undefined);
    await expectCode(
      ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER),
      'APPROVAL_ALREADY_REVIEWED',
    );
    expect(ctx.handler.apply).not.toHaveBeenCalled();
    expect(ctx.handler.afterApply).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe('ApprovalService.reject', () => {
  it('成功：記錄駁回理由並推播，不呼叫 handler', async () => {
    const ctx = setup();
    const result = await ctx.service.reject('approval-1', { comment: '資料不完整' }, REVIEWER);

    expect(result).toMatchObject({ status: 'rejected', reviewComment: '資料不完整' });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approval.reject' }),
      ctx.tx,
    );
    expect(ctx.handler.apply).not.toHaveBeenCalled();
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'approval', kind: 'update', id: 'approval-1' }],
      affectedUserIds: [],
    });
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'approval.resultMail' }),
      { approvalId: 'approval-1' },
      { tx: ctx.tx },
    );
  });

  it('發出對外事件 approval.decided（decision: rejected）', async () => {
    const ctx = setup();
    await ctx.service.reject('approval-1', {}, REVIEWER);
    expect(ctx.webhooks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.decided' }),
      { approvalId: 'approval-1', approvalType: 'user.register', decision: 'rejected' },
      ctx.tx,
    );
  });

  it('有申請人：通知申請人駁回結果', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ requesterId: 'member-1' }));
    await ctx.service.reject('approval-1', {}, REVIEWER);
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval.result',
        recipientId: 'member-1',
        params: { approvalType: 'user.register', subject: 'Alice', status: 'rejected' },
      }),
      ctx.tx,
    );
  });

  it('併發審核時沒搶到 → APPROVAL_ALREADY_REVIEWED', async () => {
    const ctx = setup();
    ctx.repo.review.mockResolvedValueOnce(undefined);
    await expectCode(ctx.service.reject('approval-1', {}, REVIEWER), 'APPROVAL_ALREADY_REVIEWED');
    expect(ctx.events.publish).not.toHaveBeenCalled();
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });
});

describe('ApprovalHandlerRegistry', () => {
  it('同一類型重複註冊 → 啟動時就失敗', () => {
    const registry = new ApprovalHandlerRegistry();
    const handler = { type: ApprovalType.USER_REGISTER } as ApprovalHandler;
    registry.register(handler);
    expect(() => registry.register(handler)).toThrow(/已經註冊過/);
  });

  it('沒有 handler 的類型 → 拋錯', () => {
    expect(() => new ApprovalHandlerRegistry().get('unknown.type')).toThrow(/沒有註冊 handler/);
  });
});

describe('ApprovalService.submit 的重新送出（docs/architecture/backend/20-approval.md §9.9）', () => {
  const MEMBER = { id: 'member-1', name: 'm@example.com' };
  const RESUBMIT: SubmitApprovalInput = {
    ...SUBMIT,
    requester: MEMBER,
    resubmittedFrom: 'approval-0',
  };

  it('前一筆是自己的、同類型、已駁回 → 建立並記下前一筆', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValueOnce(
      row({ id: 'approval-0', requesterId: MEMBER.id, status: 'rejected' }),
    );

    await ctx.service.submit(RESUBMIT);

    expect(ctx.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ resubmittedFrom: 'approval-0' }),
      ctx.tx,
    );
  });

  it('已撤回的也可以', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValueOnce(
      row({ id: 'approval-0', requesterId: MEMBER.id, status: 'withdrawn' }),
    );

    await expect(ctx.service.submit(RESUBMIT)).resolves.toBeDefined();
  });

  it.each([
    ['不存在', undefined],
    ['別人的', row({ id: 'approval-0', requesterId: 'someone-else', status: 'rejected' })],
    ['還在審', row({ id: 'approval-0', requesterId: 'member-1', status: 'pending' })],
    ['已核准', row({ id: 'approval-0', requesterId: 'member-1', status: 'approved' })],
    [
      '類型不同',
      row({
        id: 'approval-0',
        requesterId: 'member-1',
        status: 'rejected',
        type: ApprovalType.FILE_FOLDER_ACCESS,
      }),
    ],
  ])('前一筆%s → 422 APPROVAL_RESUBMIT_INVALID，不建立', async (_label, previous) => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValueOnce(previous);

    await expectCode(ctx.service.submit(RESUBMIT), 'APPROVAL_RESUBMIT_INVALID');
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });

  it('匿名的申請（註冊）不能重新送出', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValueOnce(
      row({ id: 'approval-0', requesterId: null, status: 'rejected' }),
    );

    await expectCode(
      ctx.service.submit({ ...SUBMIT, resubmittedFrom: 'approval-0' }),
      'APPROVAL_RESUBMIT_INVALID',
    );
  });
});

describe('ApprovalService.counts（待審數，docs/architecture/backend/20-approval.md §8）', () => {
  it('有 approval:read：待我審核與全部的待審', async () => {
    const ctx = setup({ permissions: new Set(['approval:read']), isSuperAdmin: false });
    ctx.repo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(7);

    await expect(ctx.service.counts(REVIEWER)).resolves.toEqual({ assigned: 2, pending: 7 });
    expect(ctx.repo.count).toHaveBeenCalledWith({ scope: 'assigned' }, REVIEWER.id);
    expect(ctx.repo.count).toHaveBeenCalledWith({ scope: 'all', status: ['pending'] }, REVIEWER.id);
  });

  it('沒有 approval:read：pending 為 null，不留 authz.denied', async () => {
    const ctx = setup({ permissions: new Set(), isSuperAdmin: false });
    ctx.repo.count.mockResolvedValueOnce(1);

    await expect(ctx.service.counts(REVIEWER)).resolves.toEqual({ assigned: 1, pending: null });
    expect(ctx.repo.count).toHaveBeenCalledTimes(1);
    expect(ctx.denials.recordSafely).not.toHaveBeenCalled();
  });

  it('多階段停用時沒有待我審核（D12）', async () => {
    const ctx = setup();
    ctx.chain.isEnabled.mockReturnValue(false);
    ctx.repo.count.mockResolvedValueOnce(4);

    await expect(ctx.service.counts(REVIEWER)).resolves.toEqual({ assigned: 0, pending: 4 });
  });
});
