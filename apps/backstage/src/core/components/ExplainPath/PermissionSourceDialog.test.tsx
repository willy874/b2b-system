import { installFlowDom } from '@b2b-system/ui/testing';
import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ExplainNode, PermissionSources } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { PermissionSourceDialog } from './PermissionSourceDialog';

beforeAll(() => {
  installFlowDom();
  initTestI18n();
});

const ME: ExplainNode = { type: 'user', id: 'u1', relation: '', name: 'Me', hidden: false };
const EDITOR: ExplainNode = {
  type: 'role',
  id: 'r1',
  relation: 'holder',
  name: '編輯',
  hidden: false,
};
const HIDDEN: ExplainNode = {
  type: 'role',
  id: null,
  relation: 'holder',
  name: null,
  hidden: true,
};

const DATA: PermissionSources = {
  isSuperAdmin: false,
  superAdminVia: null,
  items: [
    {
      key: 'user:read',
      nameI18nKey: 'permission.user.read',
      resource: 'user',
      resourceNameI18nKey: 'permission.resource.user',
      includes: [],
      requires: [],
      sources: [
        { grantedKey: 'user:read', grantedNameI18nKey: 'permission.user.read', via: [ME, EDITOR] },
        {
          grantedKey: 'user:update',
          grantedNameI18nKey: 'permission.user.update',
          via: [ME, HIDDEN],
        },
      ],
    },
    {
      key: 'role:read',
      nameI18nKey: 'permission.role.read',
      resource: 'role',
      resourceNameI18nKey: 'permission.resource.role',
      includes: [],
      requires: [],
      sources: [
        {
          grantedKey: 'user:assignRole',
          grantedNameI18nKey: 'permission.user.assignRole',
          via: [ME, HIDDEN],
        },
      ],
    },
  ],
};

function renderDialog(data: PermissionSources = DATA) {
  render(
    <PermissionSourceDialog
      open
      onOpenChange={vi.fn()}
      data={data}
      error={null}
      onRetry={vi.fn()}
    />,
    { wrapper: AllProviders },
  );
  return screen.getByTestId('permission-source-dialog');
}

const rows = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByTestId('permission-source')
    .map((row) => row.dataset.value);

describe('PermissionSourceDialog（docs/architecture/iam/08-explain.md §5）', () => {
  it('依資源分組顯示權限名稱與鍵；只由依賴帶出的另外標示；摘要算出角色數', () => {
    const dialog = renderDialog();
    expect(rows(dialog)).toEqual(['user:read', 'role:read']);
    const [userRead, roleRead] = within(dialog).getAllByTestId('permission-source');
    expect(userRead).toHaveTextContent('檢視使用者');
    expect(userRead).not.toHaveTextContent('依賴帶出');
    expect(roleRead).toHaveTextContent('依賴帶出');
    expect(within(dialog).getByTestId('permission-source-summary')).toHaveTextContent(
      '共 2 個權限，來自 2 個角色',
    );
    expect(within(dialog).queryByTestId('permission-source-viewer')).not.toBeInTheDocument();
  });

  it('搜尋同時比對名稱與鍵', () => {
    const dialog = renderDialog();
    const search = within(dialog).getByTestId('permission-source-search');
    fireEvent.change(search, { target: { value: '檢視角色' } });
    expect(rows(dialog)).toEqual(['role:read']);
    fireEvent.change(search, { target: { value: 'USER:' } });
    expect(rows(dialog)).toEqual(['user:read']);
    expect(within(dialog).getByTestId('permission-source-summary')).toHaveTextContent(
      '顯示 1 / 2 個權限',
    );
    fireEvent.change(search, { target: { value: 'nothing' } });
    expect(rows(dialog)).toEqual([]);
    expect(dialog).toHaveTextContent('沒有符合的權限');
  });

  it('點一個權限，在同一個對話框顯示來源；↓ 移到下一列並換掉來源', () => {
    const dialog = renderDialog();
    const [userRead, roleRead] = within(dialog).getAllByTestId('permission-source');
    fireEvent.click(userRead!);
    const viewer = within(dialog).getByTestId('permission-source-viewer');
    const paths = within(viewer).getAllByTestId('permission-source-path');
    expect(paths[0]).toHaveTextContent('明確授予');
    expect(paths[1]).toHaveTextContent('由「編輯使用者」帶出');
    // 讀不到的角色只顯示種類
    expect(paths[1]).toHaveTextContent('某個角色');

    userRead!.focus();
    fireEvent.keyDown(userRead!, { key: 'ArrowDown' });
    expect(roleRead).toHaveFocus();
    expect(roleRead).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByTestId('permission-source-viewer')).toHaveTextContent('role:read');
  });

  it('切換成樹狀圖：只畫持有的權限，依賴帶出的另外標示；點節點在右側顯示來源，篩選同樣套用', async () => {
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole('tab', { name: '樹狀圖' }));
    const tree = await within(dialog).findByTestId('permission-source-tree');
    const nodes = await within(tree).findAllByTestId('permission-source-node');
    expect(nodes.map((node) => node.dataset.value).toSorted()).toEqual(['role:read', 'user:read']);
    const roleRead = nodes.find((node) => node.dataset.value === 'role:read');
    expect(roleRead).toHaveAttribute('data-implied', 'true');

    fireEvent.click(roleRead!);
    expect(within(dialog).getByTestId('permission-source-viewer')).toHaveTextContent('role:read');

    fireEvent.change(within(dialog).getByTestId('permission-source-search'), {
      target: { value: 'user:' },
    });
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByTestId('permission-source-node')
          .map((node) => node.dataset.value),
      ).toEqual(['user:read']),
    );
  });

  it('super-admin 沒有明確的權限：只顯示說明，沒有清單', () => {
    const dialog = renderDialog({
      isSuperAdmin: true,
      superAdminVia: [ME, { ...EDITOR, relation: 'super-admin' }],
      items: [],
    });
    expect(within(dialog).getByTestId('permission-source-super-admin')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('permission-source-search')).not.toBeInTheDocument();
  });

  it('沒有任何權限 → 空狀態', () => {
    const dialog = renderDialog({ isSuperAdmin: false, superAdminVia: null, items: [] });
    expect(dialog).toHaveTextContent('沒有任何權限');
  });
});
