import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PermissionKey } from '@/core/permission';
import { renderUnhydrated, renderWithPermissions } from '@/test/renderWithPermissions';

import { PermissionGate } from './PermissionGate';

const gate = (
  <PermissionGate
    require={[PermissionKey['tenant:delete']]}
    fallback={<span data-testid="fallback">無權限</span>}
  >
    <button type="button">刪除租戶</button>
  </PermissionGate>
);

describe('PermissionGate（UI gating 的三個案例）', () => {
  it('有權限時渲染 children', () => {
    renderWithPermissions(gate, [PermissionKey['tenant:delete']]);
    expect(screen.getByRole('button', { name: '刪除租戶' })).toBeInTheDocument();
  });

  it('沒有權限時渲染 fallback', () => {
    renderWithPermissions(gate, [PermissionKey['tenant:read']]);
    expect(screen.queryByRole('button', { name: '刪除租戶' })).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('權限尚未水合時不閃現任何操作按鈕', () => {
    renderUnhydrated(gate);
    expect(screen.queryByRole('button', { name: '刪除租戶' })).not.toBeInTheDocument();
  });

  it('match=some 時持有其中一個即可', () => {
    renderWithPermissions(
      <PermissionGate
        require={[PermissionKey['tenant:delete'], PermissionKey['tenant:update']]}
        match="some"
      >
        <span data-testid="content">內容</span>
      </PermissionGate>,
      [PermissionKey['tenant:update']],
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});
