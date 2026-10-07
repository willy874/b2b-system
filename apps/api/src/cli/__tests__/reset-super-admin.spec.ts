import { describe, expect, it } from 'vitest';

import { parseResetSuperAdminArgs } from '../reset-super-admin';

describe('cli:reset-super-admin 的參數（docs/architecture/iam/05-bootstrap.md §7）', () => {
  it('--tenant ＋ --email → 租戶的 super-admin', () => {
    expect(parseResetSuperAdminArgs(['--tenant', 'acme', '--email', 'root@acme.test'])).toEqual({
      target: { tenant: 'acme' },
      email: 'root@acme.test',
      confirm: undefined,
    });
  });

  it('--platform ＋ --email ＋ --confirm → 平台管理者，帶上確認的值', () => {
    expect(
      parseResetSuperAdminArgs([
        '--platform',
        '--email',
        'ops@example.test',
        '--confirm',
        'b2b_platform',
      ]),
    ).toEqual({ target: 'platform', email: 'ops@example.test', confirm: 'b2b_platform' });
  });

  it.each([
    [['--tenant', 'acme'], '--email'],
    [['--tenant', 'acme', '--email'], '--email'],
    [['--email', 'a@b.test'], '--tenant'],
    [['--platform', '--tenant', 'acme', '--email', 'a@b.test'], '--tenant'],
    // 旗標後面接的是另一個旗標：當成沒給值
    [['--tenant', '--email', 'a@b.test'], '--tenant'],
  ])('用法不對（%j）→ 拋錯並提示 %s', (argv, hint) => {
    expect(() => parseResetSuperAdminArgs(argv)).toThrow(hint);
  });
});
