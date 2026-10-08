import { describe, expect, it } from 'vitest';

import { findBreakingChanges } from '../migration-compat';

describe('migration 相容檢查（docs/architecture/01-system.md §7 D14）', () => {
  it.each([
    ['DROP TABLE "legacy";', 'DROP TABLE'],
    ['ALTER TABLE "users" DROP COLUMN "nickname";', 'DROP COLUMN'],
    ['ALTER TABLE "users" RENAME COLUMN "a" TO "b";', 'RENAME'],
    ['ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint;', 'ALTER COLUMN … TYPE'],
    ['ALTER TABLE "users" ALTER COLUMN "age" TYPE bigint;', 'ALTER COLUMN … TYPE'],
    ['ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;', 'SET NOT NULL'],
    [
      'ALTER TABLE "users" ADD COLUMN "team" text NOT NULL;',
      'ADD COLUMN … NOT NULL（沒有 DEFAULT）',
    ],
  ])('%s → %s', (sql, rule) => {
    expect(findBreakingChanges('0001.sql', sql)).toEqual([
      { file: '0001.sql', line: 1, rule, sql },
    ]);
  });

  it.each([
    'CREATE TABLE "a" ("id" uuid PRIMARY KEY NOT NULL);',
    'ALTER TABLE "users" ADD COLUMN "team" text NOT NULL DEFAULT \'x\';',
    'ALTER TABLE "users" ADD COLUMN "nickname" text;',
    'CREATE INDEX "a_idx" ON "a" ("id");',
    '-- DROP TABLE 只是註解',
  ])('相容：%s', (sql) => {
    expect(findBreakingChanges('0001.sql', sql)).toEqual([]);
  });

  it('上一行有 -- breaking-ok: 理由 → 放行；只放行緊接的那一句', () => {
    const content = [
      '-- breaking-ok: 0040 起已不讀這一欄，這是第二次部署',
      'ALTER TABLE "users" DROP COLUMN "legacy";--> statement-breakpoint',
      '',
      'ALTER TABLE "users" DROP COLUMN "other";',
    ].join('\n');
    expect(findBreakingChanges('0041.sql', content)).toEqual([
      {
        file: '0041.sql',
        line: 4,
        rule: 'DROP COLUMN',
        sql: 'ALTER TABLE "users" DROP COLUMN "other";',
      },
    ]);
  });

  it('沒寫理由的 -- breaking-ok: 不算', () => {
    const content = '-- breaking-ok:\nDROP TABLE "a";';
    expect(findBreakingChanges('0001.sql', content)).toHaveLength(1);
  });
});
