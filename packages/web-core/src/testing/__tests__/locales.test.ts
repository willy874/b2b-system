import { describe, expect, it } from 'vitest';

import { findUnusedLocaleKeys } from '../locales';

describe('findUnusedLocaleKeys（沒有被引用的語系鍵）', () => {
  const bundle = {
    user: {
      title: '使用者',
      count_other: '{{count}} 位',
      stale: '舊的',
      commented: '只出現在註解',
    },
    permission: { user: { read: '檢視使用者' } },
  };

  it('列出程式碼裡沒有字面量的鍵；複數形收成同一個鍵、動態前綴與註解另外處理', () => {
    const sources = {
      'a.tsx': `t('user.title'); t("user.count", { count: 2 });`,
      'b.ts': `// t('user.commented')\n/* 'user.commented' */\nconst key = \`user.\${name}\`;`,
    };
    expect(findUnusedLocaleKeys({ bundles: [bundle], sources })).toEqual([
      'permission.user.read',
      'user.commented',
      'user.stale',
    ]);
    expect(
      findUnusedLocaleKeys({ bundles: [bundle], sources, dynamicPrefixes: ['permission.'] }),
    ).toEqual(['user.commented', 'user.stale']);
  });

  it('不含 ${ 的樣板字串也算引用', () => {
    expect(
      findUnusedLocaleKeys({
        bundles: [{ user: { title: 'x' } }],
        sources: { 'a.ts': 't(`user.title`)' },
      }),
    ).toEqual([]);
  });
});
