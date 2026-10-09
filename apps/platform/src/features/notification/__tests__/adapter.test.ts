import { describe, expect, it } from 'vitest';

import { notificationMessage, toNotificationVM } from '../adapter';

const base = {
  id: 'n1',
  link: null,
  readAt: null,
  createdAt: '2026-10-03T00:00:00.000Z',
};

/** 把鍵與參數串起來，看得出翻譯時帶了什麼。 */
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}${JSON.stringify(options)}` : key;

describe('toNotificationVM（平台的通知 → 畫面）', () => {
  it.each([
    ['tenant.provisioned', 'notification.type.tenantProvisioned'],
    ['tenant.provisionFailed', 'notification.type.tenantProvisionFailed'],
    ['tenant.storageNearQuota', 'notification.type.tenantStorageNearQuota'],
    ['platformAdmin.roleChanged', 'notification.type.platformAdminRoleChanged'],
    // 後端比前端新：通用的句子
    ['someday.newType', 'notification.type.unknown'],
  ])('%s → %s', (type, key) => {
    expect(toNotificationVM({ ...base, type, params: {} }).messageKey).toBe(key);
  });

  it('只取已知的參數；佈建失敗的原因放在補充；已讀與否看 readAt', () => {
    const vm = toNotificationVM({
      ...base,
      type: 'tenant.provisionFailed',
      readAt: '2026-10-03T01:00:00.000Z',
      params: { code: 'acme', name: 'Acme', reason: 'boom', secret: 'x', extra: 1 },
    });
    expect(vm).toMatchObject({
      isRead: true,
      detail: 'boom',
      params: { code: 'acme', name: 'Acme' },
    });
    expect(vm.params).not.toHaveProperty('secret');
  });

  it('儲存配額警示：使用率（數字）帶進句子', () => {
    const vm = toNotificationVM({
      ...base,
      type: 'tenant.storageNearQuota',
      params: { code: 'acme', name: 'Acme', percent: 85 },
    });
    expect(notificationMessage(t, vm)).toBe(
      'notification.type.tenantStorageNearQuota{"code":"acme","name":"Acme","percent":"85"}',
    );
  });

  it('儲存止水線警示：使用率帶進句子，圖示是警告', () => {
    const vm = toNotificationVM({
      ...base,
      type: 'storage.totalNearLimit',
      params: { percent: 100 },
    });
    expect(vm.icon).toBe('warning');
    expect(notificationMessage(t, vm)).toBe(
      'notification.type.storageTotalNearLimit{"percent":"100"}',
    );
  });

  it('換角色：角色以目前語系的名稱帶入句子；不認得的角色不帶', () => {
    const vm = toNotificationVM({
      ...base,
      type: 'platformAdmin.roleChanged',
      params: { from: 'auditor', to: 'hacker' },
    });
    expect(notificationMessage(t, vm)).toBe(
      'notification.type.platformAdminRoleChanged{"from":"notification.role.auditor"}',
    );
  });
});
