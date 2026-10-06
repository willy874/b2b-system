import { describe, expect, it } from 'vitest';

import { confirmArgument, disposableRejection } from '../script-guard';

const LOCAL = 'postgres://dev:dev@localhost:5432/b2b_platform';
const REMOTE = 'postgres://app:secret@db.prod.internal:5432/b2b_platform';

const target = (platformUrl: string, tenantUrls: string[] = []) => ({
  script: 'db:reset',
  platformUrl,
  tenantUrls,
});
const context = (overrides: Partial<Parameters<typeof disposableRejection>[1]> = {}) => ({
  nodeEnv: 'development',
  environment: undefined,
  confirm: undefined,
  ...overrides,
});

describe('會清空資料的腳本的防呆（docs/architecture/backend/02-database.md §6.1）', () => {
  it.each([
    'postgres://u:p@localhost:5432/x',
    'postgres://u:p@127.0.0.1:5433/x',
    'postgres://u:p@[::1]:5432/x',
    'postgres://u:p@postgres:5432/x',
  ])('本機的 DB（%s）不必確認', (url) => {
    expect(disposableRejection(target(url, [url]), context())).toBeUndefined();
  });

  it('執行者的 NODE_ENV 是 production → 拒絕', () => {
    expect(disposableRejection(target(LOCAL), context({ nodeEnv: 'production' }))).toMatch(
      'production',
    );
  });

  it('平台 DB 標記為 production → 拒絕，加了 --confirm 也一樣', () => {
    const rejection = disposableRejection(
      target(LOCAL),
      context({ environment: 'production', confirm: 'b2b_platform' }),
    );
    expect(rejection).toMatch('platform_environment');
  });

  it('不在本機的平台 DB 沒有確認 → 拒絕，訊息帶出要確認的 database 名稱', () => {
    expect(disposableRejection(target(REMOTE), context())).toMatch('--confirm b2b_platform');
  });

  it('平台 DB 在本機、但租戶 DB 不在本機 → 一樣要確認', () => {
    expect(disposableRejection(target(LOCAL, [REMOTE]), context())).toMatch('db.prod.internal');
  });

  it('--confirm 的值等於平台 database 名稱 → 放行；不相符 → 拒絕', () => {
    expect(
      disposableRejection(target(REMOTE), context({ confirm: 'b2b_platform' })),
    ).toBeUndefined();
    expect(disposableRejection(target(REMOTE), context({ confirm: 'other' }))).toBeDefined();
  });

  it('confirmArgument 讀 --confirm 後面的值', () => {
    expect(confirmArgument(['--confirm', 'b2b_platform'])).toBe('b2b_platform');
    expect(confirmArgument(['--confirm'])).toBeUndefined();
    expect(confirmArgument([])).toBeUndefined();
  });
});
