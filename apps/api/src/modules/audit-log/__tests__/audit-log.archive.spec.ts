import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';

import { archiveAuditLogs } from '../audit-log.archive';
import { AUDIT_LOG_ARCHIVE_BATCH_SIZE } from '../audit-log.constants';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-06T03:30:00.000Z');

/** 每次呼叫 `archive_audit_logs()` 依序回傳這些搬移筆數；SQL 本身在 test/audit-log-tiering.spec.ts。 */
function fakeDb(...batches: Array<number | undefined>) {
  const execute = vi.fn(async () => {
    const moved = batches.shift();
    return moved === undefined ? [] : [{ moved }];
  });
  return { db: { execute } as unknown as Pick<Database, 'execute'>, execute };
}

describe('archiveAuditLogs（docs/architecture/backend/06-audit-log.md §8）', () => {
  it('cutoff = now − 保留天數', async () => {
    const { db } = fakeDb(0);
    const { cutoff } = await archiveAuditLogs(db, 90, NOW);
    expect(cutoff).toEqual(new Date(NOW.getTime() - 90 * DAY));
  });

  it('第一批就不滿 → 呼叫一次就停，回傳搬移筆數', async () => {
    const { db, execute } = fakeDb(12);
    await expect(archiveAuditLogs(db, 90, NOW)).resolves.toMatchObject({ moved: 12 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('批次滿了就繼續搬，直到某批不滿；回傳總筆數', async () => {
    const { db, execute } = fakeDb(3, 3, 1);
    await expect(archiveAuditLogs(db, 90, NOW, 3)).resolves.toMatchObject({ moved: 7 });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('剛好滿一批而下一批是 0 → 呼叫兩次後停止', async () => {
    const { db, execute } = fakeDb(AUDIT_LOG_ARCHIVE_BATCH_SIZE, 0);
    await expect(archiveAuditLogs(db, 90, NOW)).resolves.toMatchObject({
      moved: AUDIT_LOG_ARCHIVE_BATCH_SIZE,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('函式沒有回列 → 視為 0，不會無限迴圈', async () => {
    const { db, execute } = fakeDb(undefined);
    await expect(archiveAuditLogs(db, 90, NOW)).resolves.toMatchObject({ moved: 0 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('中途失敗 → 往外拋（已搬的批次已提交，重跑只剩還沒搬的）', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ moved: 2 }])
      .mockRejectedValueOnce(new Error('lock timeout'));
    await expect(
      archiveAuditLogs({ execute } as unknown as Pick<Database, 'execute'>, 90, NOW, 2),
    ).rejects.toThrow('lock timeout');
  });
});
