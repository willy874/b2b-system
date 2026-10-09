import { describe, expect, it } from 'vitest';

import type { Job, JobSummary } from '@/shared/api-sdk';

import { toJobDetailVM, toJobQueueVM, toJobRowVM } from '../adapter';

const NOW = new Date('2026-09-29T12:00:00.000Z');

const SUMMARY: JobSummary = {
  id: 'j1',
  name: 'file.maintenance',
  state: 'failed',
  retryCount: 2,
  retryLimit: 2,
  createdOn: '2026-09-29T10:00:00.000Z',
  startAfter: '2026-09-29T10:00:00.000Z',
  startedOn: '2026-09-29T10:00:01.000Z',
  completedOn: '2026-09-29T10:00:02.000Z',
};

describe('toJobRowVM', () => {
  it('failed 且有 job:retry 才能重試', () => {
    expect(toJobRowVM(SUMMARY, { canRetry: true }, NOW).canRetry).toBe(true);
    expect(toJobRowVM(SUMMARY, { canRetry: false }, NOW).canRetry).toBe(false);
    expect(toJobRowVM({ ...SUMMARY, state: 'completed' }, { canRetry: true }, NOW).canRetry).toBe(
      false,
    );
  });

  it('已知的工作帶顯示名稱，未知的退回名稱本身', () => {
    expect(toJobRowVM(SUMMARY, { canRetry: false }, NOW).labelKey).toBe('job.name.fileMaintenance');
    // 後端比前端新：SDK 的型別裡沒有這個名稱
    const unknownName = 'mail.send' as string as JobSummary['name'];
    expect(
      toJobRowVM({ ...SUMMARY, name: unknownName }, { canRetry: false }, NOW).labelKey,
    ).toBeUndefined();
  });

  it('等待中且排定在未來 → scheduledAt；已經可以執行的不顯示', () => {
    const waiting = { ...SUMMARY, state: 'retry' as const, completedOn: null };
    expect(
      toJobRowVM({ ...waiting, startAfter: '2026-09-29T12:05:00.000Z' }, { canRetry: true }, NOW)
        .scheduledAt,
    ).toEqual(new Date('2026-09-29T12:05:00.000Z'));
    expect(toJobRowVM(waiting, { canRetry: true }, NOW).scheduledAt).toBeNull();
  });

  it('狀態對應完整字面量的語系鍵與色調', () => {
    expect(toJobRowVM(SUMMARY, { canRetry: false }, NOW)).toMatchObject({
      stateLabelKey: 'job.state.failed',
      stateTone: 'danger',
    });
  });
});

describe('toJobDetailVM', () => {
  const JOB: Job = { ...SUMMARY, data: null, output: { message: '連線逾時', stack: '…' } };

  it('失敗時取出錯誤訊息；data 為 null 時給空物件', () => {
    expect(toJobDetailVM(JOB)).toEqual({
      errorMessage: '連線逾時',
      data: {},
      output: { message: '連線逾時', stack: '…' },
    });
  });

  it('成功時 output 是結果，不當成錯誤', () => {
    expect(
      toJobDetailVM({ ...JOB, state: 'completed', output: { message: 'moved' } }).errorMessage,
    ).toBeNull();
  });
});

describe('toJobQueueVM', () => {
  it('保留計數與排程', () => {
    expect(
      toJobQueueVM({
        name: 'auditLog.archive',
        cron: '30 3 * * *',
        readyCount: 0,
        deferredCount: 1,
        activeCount: 0,
        failedCount: 2,
        completedCount: 5,
      }),
    ).toMatchObject({ labelKey: 'job.name.auditLogArchive', cron: '30 3 * * *', failedCount: 2 });
  });
});
