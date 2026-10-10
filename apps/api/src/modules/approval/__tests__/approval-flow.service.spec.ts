import { describe, expect, it, vi } from 'vitest';

import type { ApprovalFlowRow } from '@/db/schema';

import { ApprovalFlowService } from '../approval-flow.service';
import type { ApprovalHandler } from '../approval.types';

function handler(type: string): ApprovalHandler {
  return {
    type,
    flow: { requester: 'user', fields: [] },
    requiredPermissions: () => ['role:update'],
  } as unknown as ApprovalHandler;
}

function flow(id: string, type: string): ApprovalFlowRow {
  return {
    id,
    type,
    enabled: true,
    allowRepeatApprover: false,
    steps: [],
    version: 1,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  } as unknown as ApprovalFlowRow;
}

function setup() {
  const repo = {
    listFlows: vi.fn(async () => [flow('f1', 'a'), flow('f2', 'b')]),
    findFlow: vi.fn(async (type: string) => (type === 'a' ? flow('f1', 'a') : undefined)),
    countInFlight: vi.fn(async () => new Map([['f1', 3]])),
  };
  const permissionService = {
    getCatalog: vi.fn(async () => ({
      items: [{ key: 'role:update', nameI18nKey: 'permission.role.update' }],
    })),
  };
  const handlers = {
    all: () => [handler('a'), handler('b'), handler('c'), handler('hidden')],
    hiddenTypes: () => ['hidden'],
    get: (type: string) => handler(type),
  };
  const assignees = { isAvailable: () => true, describe: vi.fn() };
  const service = new ApprovalFlowService(
    {} as never,
    repo as never,
    handlers as never,
    assignees as never,
    {} as never,
    permissionService as never,
    {} as never,
    {} as never,
  );
  return { service, repo, permissionService };
}

describe('ApprovalFlowService.list（審批流程列表）', () => {
  it('權限目錄只查一次、進行中的計數一次查出所有流程', async () => {
    const { service, repo, permissionService } = setup();

    const result = await service.list();

    expect(permissionService.getCatalog).toHaveBeenCalledOnce();
    expect(repo.countInFlight).toHaveBeenCalledOnce();
    expect(repo.countInFlight).toHaveBeenCalledWith(['f1', 'f2']);
    expect(result.items.map((item) => [item.type, item.inFlightCount])).toEqual([
      ['a', 3],
      ['b', 0],
      ['c', 0],
    ]);
    expect(result.items[0]?.requiredPermissions).toEqual([
      { key: 'role:update', nameI18nKey: 'permission.role.update' },
    ]);
  });
});
