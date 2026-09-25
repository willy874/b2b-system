import { describe, expect, it } from 'vitest';

import {
  AUDIT_LOG_HOT_RETENTION_DAYS,
  AUDIT_LOG_MAX_RANGE_DAYS,
  resolveAuditLogRange,
} from '../audit-log.constants';
import { ListAuditLogSchema } from '../dto/list-audit-log.dto';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-25T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('resolveAuditLogRange（docs/architecture/backend/06-audit-log.md §7.2）', () => {
  it('熱表保留天數不小於查詢上限：預設查詢只會落在熱表', () => {
    expect(AUDIT_LOG_HOT_RETENTION_DAYS).toBeGreaterThanOrEqual(AUDIT_LOG_MAX_RANGE_DAYS);
  });

  it('都沒帶時查現在往前 90 天，只查熱表', () => {
    expect(resolveAuditLogRange({}, NOW)).toEqual({
      from: daysAgo(90),
      to: NOW,
      includeArchive: false,
    });
  });

  it('只帶 to 時往前推 90 天', () => {
    const to = daysAgo(200);
    expect(resolveAuditLogRange({ to }, NOW)).toMatchObject({
      from: new Date(to.getTime() - 90 * DAY),
      to,
    });
  });

  it('只帶 from 時往後推 90 天', () => {
    const from = daysAgo(200);
    expect(resolveAuditLogRange({ from }, NOW).to).toEqual(daysAgo(110));
  });

  it('只帶 from 且往後推會超過現在時，to 停在現在', () => {
    expect(resolveAuditLogRange({ from: daysAgo(10) }, NOW).to).toEqual(NOW);
  });

  it('from 早於熱表保留期時連冷表一起查', () => {
    expect(resolveAuditLogRange({ from: daysAgo(91) }, NOW).includeArchive).toBe(true);
  });
});

describe('ListAuditLogSchema 的時間範圍驗證', () => {
  it('跨度剛好 90 天可以', () => {
    const result = ListAuditLogSchema.safeParse({
      from: daysAgo(90).toISOString(),
      to: NOW.toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('跨度超過 90 天被擋下', () => {
    const result = ListAuditLogSchema.safeParse({
      from: new Date(daysAgo(90).getTime() - 1).toISOString(),
      to: NOW.toISOString(),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['from']);
  });

  it('from 晚於 to 被擋下', () => {
    const result = ListAuditLogSchema.safeParse({
      from: NOW.toISOString(),
      to: daysAgo(1).toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
