import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('data-disabled');
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

  const drop = (files: File[]) =>
    fireEvent.drop(screen.getByTestId('file-upload-dropzone'), {
      dataTransfer: { files, types: ['Files'] },
    });

  it('檔案大小以 B／KB／MB 顯示', () => {
    render(
      <FileUpload
        files={[
          new File(['x'.repeat(12)], 'small.txt'),
          new File(['x'.repeat(2048)], 'medium.txt'),
          new File(['x'.repeat(3 * 1024 * 1024)], 'large.txt'),
        ]}
        onFilesChange={vi.fn()}
      />,
    );
    const list = screen.getByTestId('file-upload-list');
    expect(list).toHaveTextContent('12 B');
    expect(list).toHaveTextContent('2.0 KB');
    expect(list).toHaveTextContent('3.0 MB');
  });

  it('accept 支援 MIME 萬用字元與完整的 MIME；空的項目不限制', () => {
    const onFilesChange = vi.fn();
    const onRejected = vi.fn();
    render(
      <FileUpload
        files={[]}
        multiple
        accept="image/*, text/csv"
        onFilesChange={onFilesChange}
        onRejected={onRejected}
      />,
    );

    drop([png(), csv(), new File(['{}'], 'data.json', { type: 'application/json' })]);

    expect(onFilesChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'image.png' }),
      expect.objectContaining({ name: 'data.csv' }),
    ]);
    expect(onRejected).toHaveBeenCalledWith([
      expect.objectContaining({
        reason: 'type',
        file: expect.objectContaining({ name: 'data.json' }),
      }),
    ]);
    expect(screen.getByTestId('file-upload-errors')).toHaveTextContent(
      'data.json：不支援的檔案類型',
    );
  });

  it('accept 結尾多一個逗號時，空的項目等於不限制', () => {
    const onFilesChange = vi.fn();
    render(<FileUpload files={[]} accept=".csv," onFilesChange={onFilesChange} />);

    drop([png()]);

    expect(onFilesChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'image.png' })]);
  });

  it('多選時新檔案接在已選的後面；之後成功的選取清掉先前的錯誤', () => {
    const onFilesChange = vi.fn();
    const existing = csv();
    render(<FileUpload files={[existing]} multiple maxSize={2} onFilesChange={onFilesChange} />);
    drop([new File(['too large'], 'big.bin')]);
    expect(screen.getByTestId('file-upload-errors')).toHaveTextContent('big.bin：檔案太大');

    drop([png()]);

    expect(onFilesChange).toHaveBeenLastCalledWith([
      existing,
      expect.objectContaining({ name: 'image.png' }),
    ]);
    expect(screen.queryByTestId('file-upload-errors')).not.toBeInTheDocument();
  });

  it('拖曳經過時標記 data-dragging，離開或放下後取消', () => {
    render(<FileUpload files={[]} onFilesChange={vi.fn()} />);
    const dropzone = screen.getByTestId('file-upload-dropzone');

    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveAttribute('data-dragging');
    fireEvent.dragLeave(dropzone);
    expect(dropzone).not.toHaveAttribute('data-dragging');

    fireEvent.dragOver(dropzone);
    drop([csv()]);
    expect(dropzone).not.toHaveAttribute('data-dragging');
  });

  it('disabled 時拖曳不標記、放下的檔案不接受，移除鈕停用', () => {
    const onFilesChange = vi.fn();
    render(<FileUpload files={[csv()]} disabled onFilesChange={onFilesChange} />);
    const dropzone = screen.getByTestId('file-upload-dropzone');

    fireEvent.dragOver(dropzone);
    expect(dropzone).not.toHaveAttribute('data-dragging');
    drop([png()]);

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /移除 data.csv/ })).toBeDisabled();
  });

  it('labels 取代預設文案', () => {
    render(
      <FileUpload
        files={[csv()]}
        onFilesChange={vi.fn()}
        labels={{ browse: 'Browse', remove: 'Remove' }}
      />,
    );
    expect(screen.getByText('Browse')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove data.csv' })).toBeInTheDocument();
  });
});
