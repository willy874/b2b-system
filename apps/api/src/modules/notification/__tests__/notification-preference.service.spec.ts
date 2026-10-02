import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';

import { NotificationEventCatalog } from '../notification-event.catalog';
import type { NotificationPolicyService, TenantPolicy } from '../notification-policy.service';
import type { NotificationPreferenceRepository } from '../notification-preference.repository';
import { NotificationPreferenceService } from '../notification-preference.service';
import { defineNotification } from '../notification.definition';

const PENDING = defineNotification('sample.pending', { category: 'sample', channels: ['inApp'] });
const RESULT = defineNotification('sample.result', {
  category: 'sample',
  channels: ['inApp', 'email'],
});
const SECURITY = defineNotification('sample.security', {
  category: 'security',
  channels: ['inApp'],
  mandatory: true,
});

const ME = { id: 'me', email: 'me@example.com' } as AuthUser;

const OPEN: TenantPolicy = { enabled: true, allowUserOverride: true };

function setup(
  policies: Record<string, TenantPolicy> = {},
  rows: Array<{ type: string; channel: string; enabled: boolean }> = [],
) {
  const repo = {
    listByUser: vi.fn(async () => rows.map((row) => ({ ...row, userId: ME.id }))),
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const catalog = new NotificationEventCatalog();
  catalog.register([PENDING, RESULT, SECURITY]);
  const policy = {
    tenantPolicy: vi.fn(async (type: string, channel: string): Promise<TenantPolicy> => {
      if (type === 'sample.security') return { enabled: true, allowUserOverride: false };
      return policies[`${type} ${channel}`] ?? OPEN;
    }),
  };
  const events = { publish: vi.fn() };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new NotificationPreferenceService(
    db as unknown as Database,
    repo as unknown as NotificationPreferenceRepository,
    policy as unknown as NotificationPolicyService,
    catalog,
    events as unknown as DomainEventBus,
  );
  return { service, repo, events };
}

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('NotificationPreferenceService.list（docs/architecture/backend/16-notification-event.md §9.2 D14、D15）', () => {
  it('可以調整的管道：沒有覆寫跟著租戶，有覆寫用自己的值', async () => {
    const { service } = setup({}, [{ type: 'sample.result', channel: 'email', enabled: false }]);
    const { items } = await service.list(ME);
    expect(items.find((item) => item.type === 'sample.result')).toEqual({
      type: 'sample.result',
      category: 'sample',
      channels: [
        { channel: 'inApp', enabled: true, isOverridden: false, lock: null },
        { channel: 'email', enabled: false, isOverridden: true, lock: null },
      ],
    });
  });

  it('鎖住的管道顯示租戶的值與原因；自己的覆寫不生效、不顯示成已覆寫', async () => {
    const { service } = setup(
      {
        'sample.pending inApp': { enabled: false, allowUserOverride: true },
        'sample.result inApp': { enabled: true, allowUserOverride: false },
      },
      [
        { type: 'sample.pending', channel: 'inApp', enabled: false },
        { type: 'sample.result', channel: 'inApp', enabled: false },
      ],
    );
    const { items } = await service.list(ME);
    const channelOf = (type: string, channel: string) =>
      items.find((item) => item.type === type)?.channels.find((item) => item.channel === channel);
    expect(channelOf('sample.pending', 'inApp')).toEqual({
      channel: 'inApp',
      enabled: false,
      isOverridden: false,
      lock: 'tenantDisabled',
    });
    expect(channelOf('sample.result', 'inApp')).toEqual({
      channel: 'inApp',
      enabled: true,
      isOverridden: false,
      lock: 'tenantRequired',
    });
    expect(channelOf('sample.security', 'inApp')).toMatchObject({
      enabled: true,
      lock: 'mandatory',
    });
  });
});

describe('NotificationPreferenceService.update（docs/architecture/backend/16-notification-event.md §9.2 D15）', () => {
  it('關掉 → 寫一列；推給自己（notificationPreference update），不寫稽核', async () => {
    const { service, repo, events } = setup();
    await service.update(
      { changes: [{ type: 'sample.result', channel: 'email', enabled: false }] },
      ME,
    );
    expect(repo.upsert).toHaveBeenCalledWith('me', 'sample.result', 'email', false, 'tx');
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'notificationPreference', kind: 'update', id: 'sample.result' }],
      affectedUserIds: ['me'],
    });
  });

  it('打開回到租戶的值、還原（null）→ 刪掉覆寫', async () => {
    const { service, repo } = setup({}, [
      { type: 'sample.result', channel: 'email', enabled: false },
      { type: 'sample.result', channel: 'inApp', enabled: false },
    ]);
    await service.update(
      {
        changes: [
          { type: 'sample.result', channel: 'email', enabled: true },
          { type: 'sample.result', channel: 'inApp', enabled: null },
        ],
      },
      ME,
    );
    expect(repo.remove).toHaveBeenCalledWith('me', 'sample.result', 'email', 'tx');
    expect(repo.remove).toHaveBeenCalledWith('me', 'sample.result', 'inApp', 'tx');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('與目前相同 → 略過，不寫也不推播', async () => {
    const { service, repo, events } = setup({}, [
      { type: 'sample.result', channel: 'email', enabled: false },
    ]);
    await service.update(
      {
        changes: [
          { type: 'sample.result', channel: 'email', enabled: false },
          { type: 'sample.pending', channel: 'inApp', enabled: true },
          { type: 'sample.result', channel: 'inApp', enabled: null },
        ],
      },
      ME,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('鎖住的管道 → 409 NOTIFICATION_PREFERENCE_LOCKED（帶原因），什麼都不寫；還原（null）仍可以', async () => {
    const { service, repo } = setup(
      {
        'sample.pending inApp': { enabled: false, allowUserOverride: true },
        'sample.result inApp': { enabled: true, allowUserOverride: false },
      },
      [{ type: 'sample.result', channel: 'inApp', enabled: false }],
    );
    for (const [change, lock] of [
      [{ type: 'sample.pending', channel: 'inApp' as const, enabled: true }, 'tenantDisabled'],
      [{ type: 'sample.result', channel: 'inApp' as const, enabled: false }, 'tenantRequired'],
      [{ type: 'sample.security', channel: 'inApp' as const, enabled: false }, 'mandatory'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一斷言每一種拒絕
      const error = await errorOf(
        service.update(
          { changes: [{ type: 'sample.result', channel: 'email', enabled: false }, change] },
          ME,
        ),
      );
      expect(error.code).toBe('NOTIFICATION_PREFERENCE_LOCKED');
      expect(error.details).toEqual({ type: change.type, channel: change.channel, lock });
    }
    expect(repo.upsert).not.toHaveBeenCalled();

    await service.update(
      { changes: [{ type: 'sample.result', channel: 'inApp', enabled: null }] },
      ME,
    );
    expect(repo.remove).toHaveBeenCalledWith('me', 'sample.result', 'inApp', 'tx');
  });

  it('沒有登記的事件、不支援的管道 → 404 NOTIFICATION_EVENT_NOT_FOUND', async () => {
    const { service } = setup();
    for (const change of [
      { type: 'sample.unknown', channel: 'inApp' as const, enabled: false },
      { type: 'sample.pending', channel: 'email' as const, enabled: false },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一斷言每一種拒絕
      const error = await errorOf(service.update({ changes: [change] }, ME));
      expect(error.code).toBe('NOTIFICATION_EVENT_NOT_FOUND');
    }
  });
});
