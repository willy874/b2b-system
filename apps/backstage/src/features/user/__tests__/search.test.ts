import {
  resetCommandPaletteRegistry,
  searchProviderRegistry,
} from '@b2b-system/web-core/command-palette';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerUserSearch } from '../search';

const { fetchUsers } = vi.hoisted(() => ({ fetchUsers: vi.fn() }));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));

beforeEach(() => {
  resetCommandPaletteRegistry();
  fetchUsers.mockReset().mockResolvedValue({
    items: [{ id: 'u1', displayName: 'Mei Lin', email: 'mei@example.com' }],
  });
});

describe('使用者的命令面板搜尋', () => {
  it('以 keyword 打列表 API、只取前幾筆、把 signal 交給 fetch；結果以 route id 連到詳情', async () => {
    registerUserSearch();
    const provider = searchProviderRegistry.get('user');
    const signal = new AbortController().signal;

    const results = await provider?.search('mei', signal);

    expect(fetchUsers).toHaveBeenCalledWith({
      params: { offset: 0, limit: 5, keyword: 'mei' },
      signal,
    });
    expect(results).toEqual([
      {
        id: 'u1',
        label: 'Mei Lin',
        description: 'mei@example.com',
        link: { route: 'user.detail', params: { userId: 'u1' } },
      },
    ]);
  });
});
