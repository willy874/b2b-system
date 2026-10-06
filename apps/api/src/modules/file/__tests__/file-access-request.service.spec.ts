import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { FileFolderRow } from '@/db/schema';
import { ApprovalType } from '@/modules/approval/approval.constants';
import type { ApprovalService } from '@/modules/approval/approval.service';
import type { ApprovalRequestDto } from '@/modules/approval/dto/approval.dto';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { FileAccessRequestService } from '../file-access-request.service';
import type { FolderNode } from '../file-access.context';
import type { FileFolderGrantRepository } from '../file-folder-grant.repository';
import { FileFolderGrantService } from '../file-folder-grant.service';
import type { FileFolderTree } from '../file-folder-tree';
import type { FileFolderRepository } from '../file-folder.repository';
import { createFileAccess } from './file-access.fixture';
import type { AccessFixtureOptions } from './file-access.fixture';

const ACTOR: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'actor@x',
  status: 'active',
};
const REQUESTER = '22222222-2222-4222-8222-222222222222';
const FOLDER = '33333333-3333-4333-8333-333333333333';
const OTHER_FOLDER = '44444444-4444-4444-8444-444444444444';
const MISSING = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const NODES: FolderNode[] = [
  { id: FOLDER, parentId: null, inheritGrants: true, createdBy: null },
  { id: OTHER_FOLDER, parentId: null, inheritGrants: true, createdBy: null },
];

function request(overrides: Partial<ApprovalRequestDto> = {}): ApprovalRequestDto {
  return {
    id: REQUEST_ID,
    type: ApprovalType.FILE_FOLDER_ACCESS,
    status: 'pending',
    payload: { folderId: FOLDER, folderName: '企劃', level: 'viewer' },
    requesterId: REQUESTER,
    requesterName: 'req@x',
    reason: '要看報表',
    reviewerId: null,
    reviewerName: null,
    reviewComment: null,
    reviewedAt: null,
    resultResourceId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 管理者：預設全域權限齊全；`access` 傳入時改用指定的權限與授權。 */
function setup(access: Omit<AccessFixtureOptions, 'nodes'> = {}) {
  const folders = {
    findById: vi.fn(async (id: string) =>
      NODES.some((node) => node.id === id)
        ? ({ id, name: id === FOLDER ? '企劃' : '其他' } as FileFolderRow)
        : undefined,
    ),
  };
  const approvals = {
    submit: vi.fn(async (): Promise<ApprovalRequestDto | undefined> => request()),
    listPendingBy: vi.fn(async (): Promise<ApprovalRequestDto[]> => []),
    findOne: vi.fn(async (_id: string): Promise<ApprovalRequestDto> => request()),
    approve: vi.fn(async () => request({ status: 'approved' })),
    reject: vi.fn(async () => request({ status: 'rejected' })),
  };
  const events = { publish: vi.fn() };
  const fixture = createFileAccess({ ...access, nodes: () => NODES });
  // assertCanShare 只用到 folders 與 access：其他依賴用不到
  const grantService = new FileFolderGrantService(
    {} as FileFolderTree,
    folders as unknown as FileFolderRepository,
    {} as FileFolderGrantRepository,
    fixture.access,
    {} as AuditService,
    {} as DomainEventBus,
  );
  const service = new FileAccessRequestService(
    approvals as unknown as ApprovalService,
    fixture.access,
    folders as unknown as FileFolderRepository,
    grantService,
    events as unknown as DomainEventBus,
  );
  return { service, approvals, events };
}

async function errorOf(promise: Promise<unknown>): Promise<AppException | undefined> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return error instanceof AppException ? error : undefined;
}

const FOLDER_UPDATED = {
  changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: FOLDER }],
};

describe('FileAccessRequestService.submit（docs/rbac/07-resource-grants.md §6.5）', () => {
  it('資料夾不存在 → FILE_FOLDER_NOT_FOUND', async () => {
    const { service, approvals } = setup({ global: [] });
    const error = await errorOf(service.submit(MISSING, { level: 'viewer' }, ACTOR));
    expect(error?.code).toBe('FILE_FOLDER_NOT_FOUND');
    expect(approvals.submit).not.toHaveBeenCalled();
  });

  it('已經有申請的等級 → FILE_ACCESS_ALREADY_GRANTED，不送出', async () => {
    const { service, approvals } = setup({
      global: [],
      grants: [{ resourceId: FOLDER, level: 'editor' }],
    });
    const error = await errorOf(service.submit(FOLDER, { level: 'contributor' }, ACTOR));
    expect(error?.code).toBe('FILE_ACCESS_ALREADY_GRANTED');
    expect(error?.details).toEqual({ level: 'contributor' });
    expect(approvals.submit).not.toHaveBeenCalled();
  });

  it('全域權限已涵蓋申請的等級也算已有 → FILE_ACCESS_ALREADY_GRANTED', async () => {
    const { service } = setup({ global: ['read'] });
    expect((await errorOf(service.submit(FOLDER, { level: 'viewer' }, ACTOR)))?.code).toBe(
      'FILE_ACCESS_ALREADY_GRANTED',
    );
  });

  it('送出 fileFolder.access 審批：去重鍵是「資料夾:申請人」，payload 帶資料夾名稱快照與等級', async () => {
    const { service, approvals } = setup({ global: [] });
    await service.submit(FOLDER, { level: 'contributor', reason: '要上傳' }, ACTOR);
    expect(approvals.submit).toHaveBeenCalledWith({
      type: ApprovalType.FILE_FOLDER_ACCESS,
      subjectKey: `${FOLDER}:${ACTOR.id}`,
      payload: { folderId: FOLDER, folderName: '企劃', level: 'contributor' },
      requester: { id: ACTOR.id, name: ACTOR.email },
      reason: '要上傳',
    });
  });

  it('理由是空字串 → 以 null 送出', async () => {
    const { service, approvals } = setup({ global: [] });
    await service.submit(FOLDER, { level: 'viewer', reason: '' }, ACTOR);
    expect(approvals.submit).toHaveBeenCalledWith(expect.objectContaining({ reason: null }));
  });

  it('已有較低的等級仍可申請更高的', async () => {
    const { service } = setup({ global: [], grants: [{ resourceId: FOLDER, level: 'viewer' }] });
    expect(await service.submit(FOLDER, { level: 'editor' }, ACTOR)).toEqual({ submitted: true });
  });

  it('建立了 → submitted: true，並推 fileFolder update 通知資料夾管理者', async () => {
    const { service, events } = setup({ global: [] });
    expect(await service.submit(FOLDER, { level: 'viewer' }, ACTOR)).toEqual({ submitted: true });
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, FOLDER_UPDATED);
  });

  it('已有待審（審批模組不另建）→ submitted: false，不推播', async () => {
    const { service, approvals, events } = setup({ global: [] });
    approvals.submit.mockResolvedValueOnce(undefined);
    expect(await service.submit(FOLDER, { level: 'viewer' }, ACTOR)).toEqual({ submitted: false });
    expect(events.publish).not.toHaveBeenCalled();
  });
});

describe('FileAccessRequestService.pendingFolderIdsOf（資料夾清單的 hasPendingAccessRequest）', () => {
  it('以申請人查自己的待審，回傳資料夾 id；payload 形狀不對的略過', async () => {
    const { service, approvals } = setup();
    approvals.listPendingBy.mockResolvedValueOnce([
      request(),
      request({ payload: { folderId: OTHER_FOLDER, folderName: '其他', level: 'manager' } }),
      request({ payload: { folderId: 'not-a-uuid', folderName: 'x', level: 'viewer' } }),
      request({ payload: { legacy: true } }),
    ]);
    const ids = await service.pendingFolderIdsOf(ACTOR);
    expect(approvals.listPendingBy).toHaveBeenCalledWith(ApprovalType.FILE_FOLDER_ACCESS, {
      requesterId: ACTOR.id,
    });
    expect(ids).toEqual(new Set([FOLDER, OTHER_FOLDER]));
  });
});

describe('FileAccessRequestService.list（資料夾的待審申請）', () => {
  it('沒有 share → AUTHZ_FORBIDDEN，不查詢', async () => {
    const { service, approvals } = setup({ global: ['read'] });
    expect((await errorOf(service.list(FOLDER, ACTOR)))?.code).toBe('AUTHZ_FORBIDDEN');
    expect(approvals.listPendingBy).not.toHaveBeenCalled();
  });

  it('資料夾不存在 → FILE_FOLDER_NOT_FOUND', async () => {
    const { service } = setup();
    expect((await errorOf(service.list(MISSING, ACTOR)))?.code).toBe('FILE_FOLDER_NOT_FOUND');
  });

  it('以「資料夾:」前綴查這個資料夾的申請，回傳申請人、等級、理由；payload 形狀不對的略過', async () => {
    const { service, approvals } = setup({
      global: [],
      grants: [{ resourceId: FOLDER, level: 'manager' }],
    });
    approvals.listPendingBy.mockResolvedValueOnce([request(), request({ payload: {} })]);
    const result = await service.list(FOLDER, ACTOR);
    expect(approvals.listPendingBy).toHaveBeenCalledWith(ApprovalType.FILE_FOLDER_ACCESS, {
      subjectKeyPrefix: `${FOLDER}:`,
    });
    expect(result.items).toEqual([
      {
        id: REQUEST_ID,
        requesterId: REQUESTER,
        requesterName: 'req@x',
        level: 'viewer',
        reason: '要看報表',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
  });
});

describe('FileAccessRequestService.approve / reject（docs/rbac/07-resource-grants.md §6.5）', () => {
  it('核准：交給審批模組（roleIds 空、帶意見）', async () => {
    const { service, approvals } = setup();
    await service.approve(FOLDER, REQUEST_ID, { comment: '好' }, ACTOR);
    expect(approvals.approve).toHaveBeenCalledWith(
      REQUEST_ID,
      { roleIds: [], comment: '好' },
      ACTOR,
    );
  });

  it('核准不在這裡推播（由 handler 的 afterApply 推）', async () => {
    const { service, events } = setup();
    await service.approve(FOLDER, REQUEST_ID, {}, ACTOR);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('駁回：交給審批模組並推 fileFolder update', async () => {
    const { service, approvals, events } = setup();
    await service.reject(FOLDER, REQUEST_ID, { comment: '不行' }, ACTOR);
    expect(approvals.reject).toHaveBeenCalledWith(REQUEST_ID, { comment: '不行' }, ACTOR);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, FOLDER_UPDATED);
  });

  it.each([
    ['approve', 'approve'],
    ['reject', 'reject'],
  ] as const)('%s：在資料夾沒有 share → AUTHZ_FORBIDDEN，不呼叫審批模組', async (method, call) => {
    const { service, approvals } = setup({
      global: [],
      grants: [{ resourceId: FOLDER, level: 'editor' }],
    });
    expect((await errorOf(service[method](FOLDER, REQUEST_ID, {}, ACTOR)))?.code).toBe(
      'AUTHZ_FORBIDDEN',
    );
    expect(approvals[call]).not.toHaveBeenCalled();
  });

  it('申請不存在（審批模組回 AppException）→ FILE_ACCESS_REQUEST_NOT_FOUND', async () => {
    const { service, approvals } = setup();
    approvals.findOne.mockRejectedValueOnce(new AppException('APPROVAL_NOT_FOUND'));
    const error = await errorOf(service.approve(FOLDER, REQUEST_ID, {}, ACTOR));
    expect(error?.code).toBe('FILE_ACCESS_REQUEST_NOT_FOUND');
    expect(error?.details).toEqual({ requestId: REQUEST_ID });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('查詢申請時非預期的錯誤照原樣拋出', async () => {
    const { service, approvals } = setup();
    approvals.findOne.mockRejectedValueOnce(new Error('db down'));
    await expect(service.reject(FOLDER, REQUEST_ID, {}, ACTOR)).rejects.toThrow('db down');
  });

  it.each([
    [
      '另一個資料夾的申請',
      { payload: { folderId: OTHER_FOLDER, folderName: '其他', level: 'viewer' } },
    ],
    ['已經審過的申請', { status: 'approved' }],
    ['其他審批類型', { type: ApprovalType.USER_REGISTER }],
    ['payload 形狀不對', { payload: { folderId: FOLDER } }],
  ] as const)('%s → FILE_ACCESS_REQUEST_NOT_FOUND，不呼叫審批模組', async (_label, overrides) => {
    const { service, approvals } = setup();
    approvals.findOne.mockResolvedValueOnce(request(overrides as Partial<ApprovalRequestDto>));
    expect((await errorOf(service.reject(FOLDER, REQUEST_ID, {}, ACTOR)))?.code).toBe(
      'FILE_ACCESS_REQUEST_NOT_FOUND',
    );
    expect(approvals.reject).not.toHaveBeenCalled();
  });
});
