import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Role } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import userZhTW from '../../locales/zh_TW.json';
import { MAX_USER_ROLES, UserRoleSelect } from '../UserRoleSelect';

const roles = Array.from({ length: MAX_USER_ROLES + 1 }, (_, index) => ({
  id: `role-${index}`,
  slug: `slug-${index}`,
  name: `角色 ${index}`,
})) as Role[];

function getRow(value: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="select-item"][data-value="${value}"]`,
  );
  if (!element) throw new Error(`找不到 select-item（data-value="${value}"）`);
  return element;
}

beforeAll(() => initTestI18n(userZhTW));

describe('UserRoleSelect', () => {
  it('選擇角色 → 回傳角色 id', async () => {
    const onValueChange = vi.fn();
    render(
      <UserRoleSelect roles={roles} value={[]} onValueChange={onValueChange} aria-label="角色" />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }));
    await userEvent.click(await screen.findByText('角色 1'));
    expect(onValueChange).toHaveBeenCalledWith(['role-1']);
  });

  it('選滿上限 → 其餘角色停用，已選的仍可取消', async () => {
    const full = roles.slice(0, MAX_USER_ROLES).map((role) => role.id);
    render(<UserRoleSelect roles={roles} value={full} onValueChange={vi.fn()} aria-label="角色" />);
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }));
    await screen.findByRole('listbox');
    expect(getRow(`role-${MAX_USER_ROLES}`)).toHaveAttribute('aria-disabled', 'true');
    expect(getRow('role-0')).not.toHaveAttribute('aria-disabled');
  });
});
