import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { ApprovalRequestRow } from '@/db/schema';
import type { ApprovalService } from '@/modules/approval/approval.service';
import type { ApprovalContext } from '@/modules/approval/approval.types';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { FolderNode } from '../file-access.context';
import {
  FileFolderAccessApprovalHandler,
  fileFolderAccessRequest,
  fileFolderAccessSubjectKey,
} from '../file-folder-access.approval';
import type { FileFolderGrantRepository } from '../file-folder-grant.repository';
import type { FileFolderRepository } from '../file-folder.repository';
import { createFileAccess } from './file-access.fixture';
import type { AccessFixtureOptions } from './file-access.fixture';

const REVIEWER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'r@x',
  status: 'active',
};
const REQUESTER = '22222222-2222-4222-8222-222222222222';
const FOLDER = '33333333-3333-4333-8333-333333333333';
const NODES: FolderNode[] = [{ id: FOLDER, parentId: null, inheritGrants: true, createdBy: null }];

function setup(access: AccessFixtureOptions, existingLevel?: 'manager') {
  const grants = {
    subjectExists: vi.fn(async () => true),
    find: vi.fn(async () => (existingLevel ? { level: existingLevel } : undefined)),
    set: vi.fn(async () => ({})),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const approvals = { registerHandler: vi.fn() };
  const folders = {
    findById: vi.fn(async (): Promise<{ id: string; name: string } | undefined> => ({
      id: FOLDER,
      name: '企劃',
    })),
  };
  const events = { publish: vi.fn() };
  const handler = new FileFolderAccessApprovalHandler(
    approvals as unknown as ApprovalService,
    createFileAccess({ nodes: () => NODES, ...access }).access,
    folders as unknown as FileFolderRepository,
    grants as unknown as FileFolderGrantRepository,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  const ctx = {
    request: {
      id: 'req-1',
      requesterId: REQUESTER,
      payload: { folderId: FOLDER, folderName: '企劃', level: 'contributor' },
    } as unknown as ApprovalRequestRow,
    reviewer: REVIEWER,
    options: { roleIds: [] },
  } satisfies ApprovalContext;
  return { handler, ctx, grants, audit, approvals, folders, events };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return error instanceof AppException ? error.code : undefined;
}

describe('FileFolderAccessApprovalHandler（docs/rbac/06-approval.md §7）', () => {
  it('審核權限是資源層級的：requiredPermissions 為空', () => {
    expect(setup({}).handler.requiredPermissions()).toEqual([]);
  });

  it('審核者在資料夾沒有 share → AUTHZ_FORBIDDEN', async () => {
    const { handler, ctx } = setup({
      global: [],
      grants: [{ resourceId: FOLDER, level: 'editor' }],
    });
    expect(await codeOf(handler.assertApprovable(ctx))).toBe('AUTHZ_FORBIDDEN');
  });

  it('授予不起申請的等級 → AUTHZ_ESCALATION', async () => {
    const { handler, ctx } = setup({ global: ['read', 'share'] });
    expect(await codeOf(handler.assertApprovable(ctx))).toBe('AUTHZ_ESCALATION');
  });

  it('資料夾管理者可以核准；套用時寫入申請人的授權與稽核（帶 approvalId）', async () => {
    const { handler, ctx, grants, audit } = setup({
      global: [],
      grants: [{ resourceId: FOLDER, level: 'manager' }],
    });
    await handler.assertApprovable(ctx);
    await handler.apply(ctx, 'tx' as unknown as Transaction);
    expect(grants.set).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'user', subjectId: REQUESTER }),
      expect.objectContaining({ level: 'contributor' }),
      'tx',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fileFolder.grant', metadata: { approvalId: 'req-1' } }),
      'tx',
    );
  });

  it('申請人已有更高的直接授權：不降級', async () => {
    const { handler, ctx, grants } = setup({}, 'manager');
    await handler.apply(ctx, 'tx' as unknown as Transaction);
    expect(grants.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: 'manager' }),
      'tx',
    );
  });
});

describe('FileFolderAccessApprovalHandler 的前置檢查與副作用（docs/rbac/07-resource-grants.md §6.5）', () => {
  it('模組初始化時向審批模組註冊自己', () => {
    const { handler, approvals } = setup({});
    handler.onModuleInit();
    expect(approvals.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('資料夾已不存在 → FILE_FOLDER_NOT_FOUND', async () => {
    const { handler, ctx, folders } = setup({});
    folders.findById.mockResolvedValueOnce(undefined);
    expect(await codeOf(handler.assertApprovable(ctx))).toBe('FILE_FOLDER_NOT_FOUND');
  });

  it('申請人已不存在 → FILE_GRANT_SUBJECT_NOT_FOUND', async () => {
    const { handler, ctx, grants } = setup({});
    grants.subjectExists.mockResolvedValueOnce(false);
    expect(await codeOf(handler.assertApprovable(ctx))).toBe('FILE_GRANT_SUBJECT_NOT_FOUND');
    expect(grants.subjectExists).toHaveBeenCalledWith('user', REQUESTER);
  });

  it('申請沒有申請人（requesterId 為 null）→ FILE_GRANT_SUBJECT_NOT_FOUND', async () => {
    const { handler, ctx } = setup({});
    const orphan = { ...ctx, request: { ...ctx.request, requesterId: null } };
    expect(await codeOf(handler.assertApprovable(orphan))).toBe('FILE_GRANT_SUBJECT_NOT_FOUND');
  });

  it('授予不起申請的等級時，AUTHZ_ESCALATION 帶出缺的權限鍵', async () => {
    const { handler, ctx } = setup({ global: ['read', 'share'] });
    const error = await handler.assertApprovable(ctx).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error instanceof AppException ? error.details : undefined).toEqual({
      missing: ['file:create'],
    });
  });

  it('全域權限齊全的管理員可以核准', async () => {
    const { handler, ctx } = setup({});
    await expect(handler.assertApprovable(ctx)).resolves.toBeUndefined();
  });

  it('套用：沒有既有授權時 before 為 null，回傳資料夾 id 當結果資源', async () => {
    const { handler, ctx, audit } = setup({});
    const outcome = await handler.apply(ctx, 'tx' as unknown as Transaction);
    expect(outcome).toEqual({ resourceId: FOLDER });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: FOLDER,
        resourceName: '企劃',
        changes: {
          before: null,
          after: { subjectType: 'user', subjectId: REQUESTER, level: 'contributor' },
        },
      }),
      'tx',
    );
  });

  it('套用：既有授權較高時，稽核的 before / after 都是原本的等級', async () => {
    const { handler, ctx, audit } = setup({}, 'manager');
    await handler.apply(ctx, 'tx' as unknown as Transaction);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          before: { subjectType: 'user', subjectId: REQUESTER, level: 'manager' },
          after: { subjectType: 'user', subjectId: REQUESTER, level: 'manager' },
        },
      }),
      'tx',
    );
  });

  it('套用：授予者是審核者、不過期', async () => {
    const { handler, ctx, grants } = setup({});
    await handler.apply(ctx, 'tx' as unknown as Transaction);
    expect(grants.set).toHaveBeenCalledWith(
      expect.anything(),
      { level: 'contributor', expiresAt: null, grantedBy: REVIEWER.id },
      'tx',
    );
  });

  it('payload 形狀不對 → 不寫入（解析失敗）', async () => {
    const { handler, ctx, grants } = setup({});
    const broken = { ...ctx, request: { ...ctx.request, payload: { folderId: FOLDER } } };
    await expect(handler.apply(broken, 'tx' as unknown as Transaction)).rejects.toThrow();
    expect(grants.set).not.toHaveBeenCalled();
  });

  it('afterApply：推 fileFolder update', async () => {
    const { handler, ctx, events } = setup({});
    await handler.afterApply(ctx, { resourceId: FOLDER });
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: FOLDER }],
    });
  });

  it('afterApply：沒有結果資源時不推播', async () => {
    const { handler, ctx, events } = setup({});
    await handler.afterApply(ctx, { resourceId: null });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('summarize：資料夾名稱的快照；形狀不對回空字串', () => {
    const { handler } = setup({});
    expect(handler.summarize({ folderId: FOLDER, folderName: '企劃', level: 'viewer' })).toBe(
      '企劃',
    );
    expect(handler.summarize({ legacy: true })).toBe('');
  });

  it('resultLink：連到申請的資料夾；形狀不對回 null', () => {
    const { handler, ctx } = setup({});
    expect(handler.resultLink(ctx.request)).toEqual({
      route: 'file.folder',
      params: { folderId: FOLDER },
    });
    expect(handler.resultLink({ ...ctx.request, payload: {} })).toBeNull();
  });
});

describe('fileFolderAccessRequest / fileFolderAccessSubjectKey（申請 → 審批請求）', () => {
  it('去重鍵是「資料夾:申請人」；不帶申請人是查整個資料夾的前綴', () => {
    expect(fileFolderAccessSubjectKey(FOLDER, REQUESTER)).toBe(`${FOLDER}:${REQUESTER}`);
    expect(fileFolderAccessSubjectKey(FOLDER)).toBe(`${FOLDER}:`);
  });

  it('申請人名稱用 email；沒有理由時為 null', () => {
    const input = fileFolderAccessRequest(
      { id: FOLDER, name: '企劃' },
      'viewer',
      REVIEWER,
      undefined,
    );
    expect(input).toEqual({
      type: 'fileFolder.access',
      subjectKey: `${FOLDER}:${REVIEWER.id}`,
      payload: { folderId: FOLDER, folderName: '企劃', level: 'viewer' },
      requester: { id: REVIEWER.id, name: REVIEWER.email },
      reason: null,
    });
  });
});
