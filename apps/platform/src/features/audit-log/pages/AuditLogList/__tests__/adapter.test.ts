import { describe, expect, it } from 'vitest';

import { auditLogFixture } from '../../../test-fixtures';
import { toAuditLogRowVM } from '../adapter';

describe('toAuditLogRowVM', () => {
  it('occurredAt 轉成 Date（時區交給顯示層）', () => {
    expect(toAuditLogRowVM(auditLogFixture()).occurredAt).toBeInstanceOf(Date);
  });

  it.each([
    ['success', true],
    ['failure', false],
  ] as const)('result = %s → isSuccess = %s', (result, isSuccess) => {
    expect(toAuditLogRowVM(auditLogFixture({ result })).isSuccess).toBe(isSuccess);
  });

  it('保留錯誤碼、資源 id 與 metadata（展開列直接使用）', () => {
    const vm = toAuditLogRowVM(
      auditLogFixture({ result: 'failure', errorCode: 'AUTHZ_FORBIDDEN', metadata: null }),
    );
    expect(vm).toMatchObject({
      errorCode: 'AUTHZ_FORBIDDEN',
      resourceId: '44444444-4444-4444-8444-444444444444',
      metadata: null,
    });
  });
});
