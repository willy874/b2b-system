import { describe, expect, it } from 'vitest';

import type { AuditLogSummary } from '@/shared/api-sdk';

import { toAuditLogDetailVM, toAuditLogRowVM } from '../adapter';

const log: AuditLogSummary = {
  id: 'log-1',
  occurredAt: '2026-09-19T02:10:00.000Z',
  actorId: 'user-1',
  actorEmail: 'admin@example.com',
  action: 'role.update',
  resourceType: 'role',
  resourceId: 'role-1',
  resourceName: '內容編輯',
  result: 'success',
  errorCode: null,
};

describe('toAuditLogRowVM', () => {
  it('occurredAt 轉成 Date（時區交給顯示層）', () => {
    expect(toAuditLogRowVM(log).occurredAt).toBeInstanceOf(Date);
  });

  it('有資源名稱時組成「類型 · 名稱」', () => {
    expect(toAuditLogRowVM(log).resourceLabel).toBe('role · 內容編輯');
  });

  it('沒有資源名稱時只顯示類型', () => {
    expect(toAuditLogRowVM({ ...log, resourceName: null }).resourceLabel).toBe('role');
  });

  it('refresh token 重用標為高風險', () => {
    expect(toAuditLogRowVM(log).isHighRisk).toBe(false);
    expect(toAuditLogRowVM({ ...log, action: 'auth.refresh.reuse_detected' }).isHighRisk).toBe(
      true,
    );
  });

  it('失敗紀錄保留錯誤碼', () => {
    const vm = toAuditLogRowVM({ ...log, result: 'failure', errorCode: 'AUTHZ_FORBIDDEN' });
    expect(vm).toMatchObject({ isSuccess: false, errorCode: 'AUTHZ_FORBIDDEN' });
  });
});

describe('toAuditLogDetailVM', () => {
  it('changes / metadata 為 null 時正規化成空物件', () => {
    expect(toAuditLogDetailVM({ ...log, changes: null, metadata: null })).toEqual({
      changes: {},
      metadata: {},
    });
  });
});
