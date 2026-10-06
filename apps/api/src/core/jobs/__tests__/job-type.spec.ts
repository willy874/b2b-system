import { describe, expect, it } from 'vitest';

import { defineJob } from '../job-type';

describe('defineJob（docs/architecture/backend/10-jobs.md §2、§3）', () => {
  it.each([
    ['auditLog.archive'],
    ['trash.purge'],
    ['jobs.outboxSweep'],
    ['a.b'],
    ['module2.action3'],
  ])('名稱 %s 符合 <模組>.<動作>（camelCase）→ 可以宣告', (name) => {
    expect(defineJob(name).name).toBe(name);
  });

  it.each([
    ['', '空字串'],
    ['archive', '缺少模組'],
    ['auditLog.', '缺少動作'],
    ['.archive', '缺少模組'],
    ['AuditLog.archive', '模組大寫開頭'],
    ['auditLog.Archive', '動作大寫開頭'],
    ['audit-log.archive', 'kebab-case'],
    ['audit_log.archive', 'snake_case'],
    ['auditLog.archive.daily', '超過兩段'],
    ['auditLog archive', '含空白'],
    ['1audit.archive', '數字開頭'],
  ])('名稱 %j（%s）在宣告時就拋錯', (name) => {
    expect(() => defineJob(name)).toThrow(/<模組>\.<動作>/);
  });

  it('沒給選項時用預設：重試 5 次、30 秒起跳、最多間隔 1 小時、執行 15 分鐘、保留 7 天、非 exclusive、租戶範圍、並行 1', () => {
    expect(defineJob('test.defaults').options).toEqual({
      retryLimit: 5,
      retryDelaySeconds: 30,
      retryDelayMaxSeconds: 3600,
      expireInSeconds: 15 * 60,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
      exclusive: false,
      scope: 'tenant',
      concurrency: 1,
    });
  });

  it('給的選項覆蓋預設，沒給的保留預設', () => {
    const type = defineJob('test.partial', { retryLimit: 0, scope: 'platform', concurrency: 5 });
    expect(type.options).toMatchObject({
      retryLimit: 0,
      scope: 'platform',
      concurrency: 5,
      retryDelaySeconds: 30,
      expireInSeconds: 15 * 60,
    });
  });

  it('每次宣告得到獨立的選項物件（改一個不影響其他工作的預設）', () => {
    const first = defineJob('test.first');
    (first.options as { retryLimit: number }).retryLimit = 99;
    expect(defineJob('test.second').options.retryLimit).toBe(5);
  });
});
