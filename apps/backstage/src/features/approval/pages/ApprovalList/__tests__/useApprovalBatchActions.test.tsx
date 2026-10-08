import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';

import { registerApprovalPagePermissions } from '../../../permission';
import type { ApprovalRowVM } from '../adapter';
import { useApprovalBatchActions } from '../useApprovalBatchActions';

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
});

function hydrate(keys: PermissionKey[], hydrated = true): void {
  usePermissionStore.setState({ permissions: new Set(keys), hydrated });
}

function actions() {
  const { result } = renderHook(() => useApprovalBatchActions(), { wrapper: AllProviders });
  return Object.fromEntries(result.current.map((action) => [action.id, action]));
}

const row = (overrides: Partial<ApprovalRowVM>): ApprovalRowVM => ({
  id: 'a1',
  type: 'user.register',
  status: 'pending',
  requesterName: 'a1@example.com',
  reviewerName: null,
  createdAt: new Date(0),
  reviewedAt: null,
  isPending: true,
  progress: null,
  stepCount: 0,
  canReview: true,
  canApprove: true,
  ...overrides,
});

describe('useApprovalBatchActions（審批列表的批次動作）', () => {
  it('有 approval:review → 核准與駁回都顯示', () => {
    hydrate([PermissionKey['approval:read'], PermissionKey['approval:review']]);
    const result = actions();
    expect(Object.keys(result)).toEqual(['approve', 'reject']);
    expect(Object.values(result).every((action) => !action.hidden)).toBe(true);
  });

  it('只有 approval:read → 全部隱藏', () => {
    hydrate([PermissionKey['approval:read']]);
    expect(Object.values(actions()).every((action) => action.hidden)).toBe(true);
  });

  it('權限未水合 → 全部隱藏，不閃現', () => {
    hydrate([PermissionKey['approval:review']], false);
    expect(Object.values(actions()).every((action) => action.hidden)).toBe(true);
  });

  it('資格沿用列旗標：已審核的不適用；缺少類型要求的權限時只能駁回', () => {
    hydrate([PermissionKey['approval:review']]);
    const { approve, reject } = actions();

    const reviewed = row({
      status: 'approved',
      isPending: false,
      canReview: false,
      canApprove: false,
    });
    expect(approve!.isEligible(reviewed)).toBe(false);
    expect(reject!.isEligible(reviewed)).toBe(false);

    const cannotCreate = row({ canApprove: false });
    expect(approve!.isEligible(cannotCreate)).toBe(false);
    expect(reject!.isEligible(cannotCreate)).toBe(true);
  });
});
