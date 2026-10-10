import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import notificationZhTW from '../../../locales/zh_TW.json';
import { UserFilterSelect } from '../components/UserFilterSelect';

const { fetchUsers, fetchUser } = vi.hoisted(() => ({ fetchUsers: vi.fn(), fetchUser: vi.fn() }));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/user/get-user-detail/fetcher', () => ({ fetchUserDetailQuery: fetchUser }));

const user = (id: string, displayName: string) => ({
  id,
  displayName,
  email: `${id}@acme.test`,
});

function renderSelect(value: string | undefined) {
  const onChange = vi.fn();
  render(
    <UserFilterSelect
      value={value}
      onChange={onChange}
      label="收件人"
      placeholder="所有收件人"
      data-testid="notification-overview-recipient"
    />,
    { wrapper: AllProviders },
  );
  return onChange;
}

const trigger = () => screen.getByRole('combobox', { name: '收件人' });

beforeAll(() => initTestI18n(notificationZhTW));

beforeEach(() => {
  fetchUsers.mockReset().mockImplementation(async ({ params }) => {
    const items = params.keyword
      ? [user('u-carol', 'Carol')]
      : [user('u-alice', 'Alice'), user('u-bob', 'Bob')];
    return { items, pagination: { offset: 0, limit: 20, total: items.length } };
  });
  fetchUser.mockReset().mockResolvedValue(user('u-zed', 'Zed'));
});

describe('UserFilterSelect（通知總覽的收件人、觸發者篩選）', () => {
  it('沒有選人時顯示「所有收件人」；下拉還沒打開時不查使用者列表與個人資料', async () => {
    renderSelect(undefined);
    expect(trigger()).toHaveTextContent('所有收件人');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchUsers).not.toHaveBeenCalled();
    expect(fetchUser).not.toHaveBeenCalled();
  });

  it('打開下拉才查；選一位使用者 → 回報他的 id', async () => {
    const onChange = renderSelect(undefined);
    fireEvent.click(trigger());
    await waitFor(() => expect(fetchUsers).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('option', { name: /Bob/ }));
    expect(onChange).toHaveBeenCalledWith('u-bob');
  });

  it('輸入關鍵字 → 停頓後以去掉空白的關鍵字在伺服器端搜尋', async () => {
    renderSelect(undefined);
    await userEvent.click(trigger());
    const input = await screen.findByRole('combobox', { name: '搜尋…' });
    await userEvent.type(input, ' car ');
    await waitFor(() =>
      expect(fetchUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: { offset: 0, limit: 20, keyword: 'car' } }),
      ),
    );
    expect(await screen.findByRole('option', { name: /Carol/ })).toBeInTheDocument();
  });

  it('網址帶進來的收件人不在搜尋結果裡 → 另外取他的名稱來顯示', async () => {
    renderSelect('u-zed');
    await waitFor(() => expect(trigger()).toHaveTextContent('Zed'));
    expect(fetchUser).toHaveBeenCalledWith(
      expect.objectContaining({ params: { userId: 'u-zed' } }),
    );
  });

  it('有選中的人時只查他一個人的名稱，不查整個列表', async () => {
    fetchUser.mockResolvedValue(user('u-alice', 'Alice'));
    renderSelect('u-alice');
    await waitFor(() => expect(trigger()).toHaveTextContent('Alice'));
    expect(fetchUsers).not.toHaveBeenCalled();
  });
});
