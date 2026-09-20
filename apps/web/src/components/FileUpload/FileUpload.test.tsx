import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload } from './index';

const csv = () => new File(['a,b'], 'data.csv', { type: 'text/csv' });
const png = () => new File(['x'], 'image.png', { type: 'image/png' });

describe('FileUpload', () => {
  it('選檔後回傳檔案', async () => {
    const onFilesChange = vi.fn();
    render(<FileUpload files={[]} onFilesChange={onFilesChange} />);
    await userEvent.upload(screen.getByTestId('file-upload-input'), csv());
    expect(onFilesChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'data.csv' })]);
  });

  it('列出已選檔案並可移除', async () => {
    const onFilesChange = vi.fn();
    const file = csv();
    render(<FileUpload files={[file]} onFilesChange={onFilesChange} />);
    expect(screen.getByTestId('file-upload-list')).toHaveTextContent('data.csv');
    await userEvent.click(screen.getByRole('button', { name: /移除 data.csv/ }));
    expect(onFilesChange).toHaveBeenCalledWith([]);
  });

  // 檔案對話框會由瀏覽器依 `accept` 先過濾，因此這一條用拖放來驗證元件自己的把關
  it('拖入不符合 accept 的檔案時被拒絕並顯示原因', async () => {
    const onFilesChange = vi.fn();
    const onRejected = vi.fn();
    render(
      <FileUpload files={[]} accept=".csv" onFilesChange={onFilesChange} onRejected={onRejected} />,
    );

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.drop(screen.getByTestId('file-upload-dropzone'), {
      dataTransfer: { files: [png()], types: ['Files'] },
    });

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith([expect.objectContaining({ reason: 'type' })]);
    expect(screen.getByTestId('file-upload-errors')).toHaveTextContent('不支援的檔案類型');
  });

  it('超過 maxSize 的檔案被拒絕', async () => {
    const onFilesChange = vi.fn();
    render(<FileUpload files={[]} maxSize={1} onFilesChange={onFilesChange} />);
    await userEvent.upload(screen.getByTestId('file-upload-input'), csv());
    expect(onFilesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('file-upload-errors')).toHaveTextContent('檔案太大');
  });

  it('單選模式下新檔案取代舊的', async () => {
    const onFilesChange = vi.fn();
    render(<FileUpload files={[csv()]} onFilesChange={onFilesChange} />);
    await userEvent.upload(screen.getByTestId('file-upload-input'), png());
    expect(onFilesChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'image.png' })]);
  });

  it('disabled 時 input 不可用', () => {
    render(<FileUpload files={[]} disabled onFilesChange={vi.fn()} />);
    expect(screen.getByTestId('file-upload-input')).toBeDisabled();
  });

  it('拖放檔案也會被接受', async () => {
    const onFilesChange = vi.fn();
    render(<FileUpload files={[]} multiple onFilesChange={onFilesChange} />);
    const dropzone = screen.getByTestId('file-upload-dropzone');
    const file = csv();

    const dataTransfer = {
      files: [file],
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      types: ['Files'],
    };
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.drop(dropzone, { dataTransfer });

    expect(onFilesChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'data.csv' })]);
  });
});
