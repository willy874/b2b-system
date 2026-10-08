import { renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApprovalRowVM } from '../adapter';
import { ApprovalRowActions } from '../components/ApprovalRowActions';

const ROW: ApprovalRowVM = {
  id: 'a1',
  type: 'user.register',
  status: 'pending',
  requesterName: 'alice@example.com',
  reviewerName: null,
  createdAt: new Date('2026-09-25T01:00:00.000Z'),
  reviewedAt: null,
  isPending: true,
  progress: null,
  stepCount: 0,
  canReview: true,
  canApprove: true,
};

describe('ApprovalRowActions（列上的快速審核）', () => {
  it('可以審核 → 顯示核准與駁回', () => {
    renderWithPermissions(<ApprovalRowActions row={ROW} />);
    expect(screen.getByTestId('approval-quick-approve')).toBeEnabled();
    expect(screen.getByTestId('approval-quick-reject')).toBeEnabled();
  });

  it('沒有審核權限或已審核（canReview = false）→ 不渲染', () => {
    renderWithPermissions(
      <ApprovalRowActions row={{ ...ROW, canReview: false, canApprove: false }} />,
    );
    expect(screen.queryByTestId('approval-quick-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-quick-reject')).not.toBeInTheDocument();
  });

  it('權限未水合時 adapter 不給 canReview → 不閃現', () => {
    renderUnhydrated(<ApprovalRowActions row={{ ...ROW, canReview: false, canApprove: false }} />);
    expect(screen.queryByTestId('approval-quick-approve')).not.toBeInTheDocument();
  });

  it('缺少類型要求的權限 → 核准停用，駁回仍可用', () => {
    renderWithPermissions(<ApprovalRowActions row={{ ...ROW, canApprove: false }} />);
    // 有說明文字時 Tooltip 讓它改用 aria-disabled（可 hover），測試環境沒載入語系則是原生 disabled
    expect(
      screen.getByTestId('approval-quick-approve').matches(':disabled, [aria-disabled="true"]'),
    ).toBe(true);
    expect(screen.getByTestId('approval-quick-reject')).toBeEnabled();
  });

  it('點駁回先開確認框，不會直接送出', async () => {
    renderWithPermissions(<ApprovalRowActions row={ROW} />);
    fireEvent.click(screen.getByTestId('approval-quick-reject'));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});
