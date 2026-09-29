import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { ApprovalRequestRow } from '@/db/schema';
import type { ApprovalService } from '@/modules/approval/approval.service';
import type { ApprovalContext } from '@/modules/approval/approval.types';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { ResourceGrantService } from '@/modules/resource-grant/resource-grant.service';

import type { FolderNode } from '../file-access.context';
import { FileFolderAccessApprovalHandler } from '../file-folder-access.approval';
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
  const handler = new FileFolderAccessApprovalHandler(
    { registerHandler: vi.fn() } as unknown as ApprovalService,
    createFileAccess({ nodes: () => NODES, ...access }).access,
    {
      findById: vi.fn(async () => ({ id: FOLDER, name: '企劃' })),
    } as unknown as FileFolderRepository,
    grants as unknown as ResourceGrantService,
    audit as unknown as AuditService,
    { publish: vi.fn() } as unknown as DomainEventBus,
  );
  const ctx = {
    request: {
      id: 'req-1',
      requesterId: REQUESTER,
      payload: {
        workspaceId: '99999999-9999-4999-8999-999999999999',
        folderId: FOLDER,
        folderName: '企劃',
        level: 'contributor',
      },
    } as unknown as ApprovalRequestRow,
    reviewer: REVIEWER,
    options: { roleIds: [] },
  } satisfies ApprovalContext;
  return { handler, ctx, grants, audit };
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
