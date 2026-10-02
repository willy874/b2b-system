import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { ApprovalRequestRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationService } from '@/modules/notification/notification.service';
import type { PermissionService } from '@/modules/permission/permission.service';
import type { WebhookService } from '@/modules/webhook/webhook.service';

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
    review: vi.fn(
      async (
        _id: string,
        values: Partial<ApprovalRequestRow>,
      ): Promise<ApprovalRequestRow | undefined> => row({ ...values, privatePayload: null }),
    ),
    setResult: vi.fn(async () => undefined),
  };
  const permissionService = {
    getPermissionSet: vi.fn(async () => permissionSet),
    findActiveUserIdsWithPermission: vi.fn(async () => ['reviewer-1', 'reviewer-2']),
  };
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

  const service = new ApprovalService(
    db as never,
    repo as unknown as ApprovalRepository,
    new ApprovalHandlerRegistry(),
    permissionService as unknown as PermissionService,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    jobs as unknown as JobQueue,
    notifications as unknown as NotificationService,
    webhooks as unknown as WebhookService,
  );
  service.registerHandler(handler);
  return {
    service,
    repo,
    audit,
    events,
    handler,
    tx,
    jobs,
    notifications,
    permissionService,
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

  it('有申請人：在同一個交易內通知申請人核准結果，連到審批詳情', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(row({ requesterId: 'member-1' }));
    await ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      {
        type: 'approval.result',
        recipientId: 'member-1',
        actorId: REVIEWER.id,
        params: { approvalType: 'user.register', subject: 'Alice', status: 'approved' },
        link: { route: 'approval.detail', params: { approvalId: 'approval-1' } },
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

  it('缺少 handler 要求的權限 → AUTHZ_FORBIDDEN 並帶出缺少的鍵，不寫入任何東西', async () => {
    const ctx = setup({ permissions: new Set(['approval:review']), isSuperAdmin: false });
    const operation = ctx.service.approve('approval-1', { roleIds: [] }, REVIEWER);
    await expect(operation).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { missing: ['user:create'] },
    });
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
