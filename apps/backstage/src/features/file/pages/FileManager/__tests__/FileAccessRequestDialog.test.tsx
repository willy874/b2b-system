import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileAccessRequestDialog } from '../components/FileAccessRequestDialog';
import { FileLockedNotice } from '../components/FileLockedNotice';

const { createRequest } = vi.hoisted(() => ({ createRequest: vi.fn() }));
vi.mock('@/apis/file/create-file-access-request/mutation', () => ({
  getFileAccessRequestCreateMutationOptions: () => ({ mutationFn: createRequest }),
}));

beforeEach(() => {
  createRequest.mockReset().mockResolvedValue({ submitted: true });
});

describe('FileAccessRequestDialog（docs/architecture/iam/06-resource-grants.md §6.5）', () => {
  it('送出資料夾、預設等級 viewer 與理由；成功後關閉', async () => {
    const onClose = vi.fn();
    renderWithPermissions(
      <FileAccessRequestDialog folder={{ id: 'plan', name: '企劃' }} onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId('file-access-request-reason'), {
      target: { value: '  需要看企劃  ' },
    });
    fireEvent.click(screen.getByTestId('file-access-request-submit'));
    await waitFor(() =>
      expect(createRequest.mock.calls[0]?.[0]).toEqual({
        params: { folderId: 'plan', body: { level: 'viewer', reason: '需要看企劃' } },
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('理由空白時不送 reason', async () => {
    renderWithPermissions(
      <FileAccessRequestDialog folder={{ id: 'plan', name: '企劃' }} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('file-access-request-submit'));
    await waitFor(() =>
      expect(createRequest.mock.calls[0]?.[0]).toEqual({
        params: { folderId: 'plan', body: { level: 'viewer', reason: undefined } },
      }),
    );
  });
});

describe('FileLockedNotice', () => {
  it('沒有申請時顯示「申請存取」鈕；已申請時只顯示狀態', () => {
    const onRequest = vi.fn();
    const { rerender } = renderWithPermissions(
      <FileLockedNotice pending={false} onRequest={onRequest} />,
    );
    fireEvent.click(screen.getByTestId('file-access-request-button'));
    expect(onRequest).toHaveBeenCalled();

    rerender(<FileLockedNotice pending onRequest={onRequest} />);
    expect(screen.getByTestId('file-locked-notice')).toHaveAttribute('data-value', 'pending');
    expect(screen.queryByTestId('file-access-request-button')).toBeNull();
  });
});
