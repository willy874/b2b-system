import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { SettingService } from '@/core/settings';
import type { DataTransferRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationService } from '@/modules/notification/notification.service';

import {
  DATA_TRANSFER_RESOURCE_TYPE,
  DataTransferLifecycle,
  toTransferDto,
} from '../data-transfer.lifecycle';
import type { DataTransferRepository } from '../data-transfer.repository';
import { transferRow } from './data-transfer.fixture';

const NOW = new Date('2026-10-08T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function setup(retentionDays = 7) {
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    transition: vi.fn(
      async (
        _id: string,
        _from: string[],
        values: Partial<DataTransferRow>,
      ): Promise<DataTransferRow | undefined> => transferRow(values),
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const notifications = { notify: vi.fn(async () => []) };
  const events = { publish: vi.fn() };
  const settings = { get: vi.fn(async () => retentionDays) };
  const lifecycle = new DataTransferLifecycle(
    db as never,
    repo as unknown as DataTransferRepository,
    audit as unknown as AuditService,
    notifications as unknown as NotificationService,
    events as unknown as DomainEventBus,
    settings as unknown as SettingService,
  );
  return { lifecycle, tx, repo, audit, notifications, events };
}

describe('toTransferDto（傳輸列 → API 回應）', () => {
  it('日期轉成 ISO 字串，記下的範圍與欄位帶出來', () => {
    const dto = toTransferDto(
      transferRow({
        params: { scope: { kind: 'ids', ids: ['a'] }, columns: ['name', 1] },
        startedAt: new Date('2026-10-08T07:00:00.000Z'),
        finishedAt: new Date('2026-10-08T08:00:00.000Z'),
      }),
    );
    expect(dto).toMatchObject({
      id: 'transfer-1',
      mode: null,
      scopeKind: 'ids',
      columns: ['name', '1'],
      startedAt: '2026-10-08T07:00:00.000Z',
      finishedAt: '2026-10-08T08:00:00.000Z',
      expiresAt: '2026-12-31T00:00:00.000Z',
      createdAt: '2026-10-08T06:30:00.000Z',
    });
  });

  it.each([
    ['匯入（沒有 scope、columns 不是陣列）', { skipInvalid: true, columns: 'x' }, null, []],
    ['未知的範圍種類', { scope: { kind: 'all' } }, null, []],
    ['依篩選條件', { scope: { kind: 'filter' }, columns: [] }, 'filter', []],
  ])('%s', (_name, params, scopeKind, columns) => {
    const dto = toTransferDto(transferRow({ params, mode: 'create' }));
    expect(dto.scopeKind).toBe(scopeKind);
    expect(dto.columns).toEqual(columns);
    expect(dto.mode).toBe('create');
    expect(dto.startedAt).toBeNull();
    expect(dto.finishedAt).toBeNull();
  });
});

describe('DataTransferLifecycle（docs/architecture/backend/22-data-transfer.md §6.3、§7.6、§9.3、§9.4）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expiresAt：從完成時起算 dataTransfer.retentionDays；沒給起點時從現在起算', async () => {
    const { lifecycle } = setup(7);
    const from = new Date('2026-01-01T00:00:00.000Z');
    await expect(lifecycle.expiresAt(from)).resolves.toEqual(new Date(from.getTime() + 7 * DAY_MS));
    await expect(lifecycle.expiresAt()).resolves.toEqual(new Date(NOW.getTime() + 7 * DAY_MS));
  });

  it('pendingExpiresAt：還沒結束的傳輸佔位 90 天', () => {
    const { lifecycle } = setup();
    expect(lifecycle.pendingExpiresAt()).toEqual(new Date(NOW.getTime() + 90 * DAY_MS));
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(lifecycle.pendingExpiresAt(from)).toEqual(new Date(from.getTime() + 90 * DAY_MS));
  });

  it('publish：只推播給建立者（perRecipient）', () => {
    const { lifecycle, events } = setup();
    lifecycle.publish({ id: 'transfer-1', createdBy: 'user-1' }, ChangeKind.UPDATE);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [],
      perRecipient: [
        {
          userId: 'user-1',
          changes: [
            { resource: ChangeSource.DATA_TRANSFER, kind: ChangeKind.UPDATE, id: 'transfer-1' },
          ],
        },
      ],
    });
  });

  describe('notifyFinished（§9.3）', () => {
    it('匯出：系統通知（actorId null），帶格式與列數，在傳入的交易內寫入', async () => {
      const { lifecycle, notifications, tx } = setup();
      await lifecycle.notifyFinished(
        transferRow({ status: 'completed', totalRows: 12 }),
        tx as never,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dataTransfer.exportFinished',
          recipientId: 'user-1',
          actorId: null,
          sourceId: 'transfer-1',
          params: { status: 'completed', type: 'widget', format: 'csv', rows: 12, errorCode: null },
        }),
        tx,
      );
    });

    it('匯入：帶模式與成功、失敗、略過的列數；沒有模式時視為 create', async () => {
      const { lifecycle, notifications, tx } = setup();
      await lifecycle.notifyFinished(
        transferRow({
          direction: 'import',
          status: 'failed',
          succeededRows: 3,
          failedRows: 2,
          skippedRows: 1,
          errorCode: 'INTERNAL_ERROR',
        }),
        tx as never,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dataTransfer.importFinished',
          actorId: null,
          params: {
            status: 'failed',
            type: 'widget',
            mode: 'create',
            succeeded: 3,
            failed: 2,
            skipped: 1,
            errorCode: 'INTERNAL_ERROR',
          },
        }),
        tx,
      );

      await lifecycle.notifyFinished(
        transferRow({ direction: 'import', mode: 'update' }),
        tx as never,
      );
      expect(notifications.notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ mode: 'update' }) }),
        tx,
      );
    });
  });

  describe('fail', () => {
    it('從 queued／running／applying 轉成 failed，記下錯誤碼與到期時間，通知並推播建立者', async () => {
      const { lifecycle, repo, notifications, events, tx } = setup(7);
      const failed = await lifecycle.fail('transfer-1', 'DATA_TRANSFER_TOO_MANY_ROWS', {
        max: 10,
      });

      expect(repo.transition).toHaveBeenCalledWith(
        'transfer-1',
        ['queued', 'running', 'applying'],
        {
          status: 'failed',
          errorCode: 'DATA_TRANSFER_TOO_MANY_ROWS',
          errorDetails: { max: 10 },
          finishedAt: NOW,
          expiresAt: new Date(NOW.getTime() + 7 * DAY_MS),
        },
        { tx },
      );
      expect(failed?.status).toBe('failed');
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenCalledTimes(1);
    });

    it('沒有給 details 時記 null', async () => {
      const { lifecycle, repo } = setup();
      await lifecycle.fail('transfer-1', 'INTERNAL_ERROR');
      expect(repo.transition).toHaveBeenCalledWith(
        'transfer-1',
        expect.any(Array),
        expect.objectContaining({ errorDetails: null }),
        expect.anything(),
      );
    });

    it('已經被取消或結束的不覆寫：不通知、不推播，回傳 undefined', async () => {
      const { lifecycle, repo, notifications, events } = setup();
      repo.transition.mockResolvedValueOnce(undefined);
      await expect(lifecycle.fail('transfer-1', 'INTERNAL_ERROR')).resolves.toBeUndefined();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });
  });

  describe('record（稽核，§9.2）', () => {
    it.each([
      [
        '有產出檔名時用產出檔名',
        { outputName: 'widgets.csv', sourceName: 'in.csv' },
        'widgets.csv',
      ],
      ['沒有產出時用來源檔名', { sourceName: 'in.csv' }, 'in.csv'],
      ['都沒有時用資源類型', {}, 'widget'],
    ])('%s', async (_name, overrides, resourceName) => {
      const { lifecycle, audit, tx } = setup();
      await lifecycle.record('dataTransfer.cancel', transferRow(overrides), { a: 1 }, tx as never);
      expect(audit.record).toHaveBeenCalledWith(
        {
          action: 'dataTransfer.cancel',
          resourceType: DATA_TRANSFER_RESOURCE_TYPE,
          resourceId: 'transfer-1',
          resourceName,
          metadata: { a: 1 },
        },
        tx,
      );
    });
  });
});
