import { AppError } from '@b2b-system/web-core/errors';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { TEXT_PREVIEW_MAX_BYTES, TextPreview } from '../TextPreview';

const { fetchFileText } = vi.hoisted(() => ({ fetchFileText: vi.fn() }));
vi.mock('@/apis/file/get-file-text/fetcher', () => ({ fetchFileText }));

const file = {
  id: 'f1',
  name: 'data.json',
  contentType: 'application/json',
  size: 10,
  url: 'http://s/f1?inline',
  displayUrl: null,
};

describe('TextPreview（純文字預覽）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  beforeEach(() => {
    fetchFileText.mockReset();
  });

  it('只讀開頭 256 KB，JSON 自動排版', async () => {
    fetchFileText.mockResolvedValue({ text: '{"a":1}', truncated: false });
    renderWithPermissions(<TextPreview file={file} />);

    const container = await screen.findByTestId('file-preview-text');
    expect(container.querySelector('pre')?.textContent).toBe('{\n  "a": 1\n}');
    expect(fetchFileText).toHaveBeenCalledWith(
      { url: file.url, maxBytes: TEXT_PREVIEW_MAX_BYTES },
      expect.anything(),
    );
    expect(screen.queryByTestId('file-preview-truncated')).not.toBeInTheDocument();
  });

  it('JSON 解析失敗照原樣顯示', async () => {
    fetchFileText.mockResolvedValue({ text: '{broken', truncated: false });
    renderWithPermissions(<TextPreview file={file} />);
    const container = await screen.findByTestId('file-preview-text');
    expect(container.querySelector('pre')?.textContent).toBe('{broken');
  });

  it('非 JSON 保留原本的換行與空白', async () => {
    fetchFileText.mockResolvedValue({ text: 'line 1\n  line 2', truncated: false });
    renderWithPermissions(<TextPreview file={{ ...file, contentType: 'text/plain' }} />);
    const container = await screen.findByTestId('file-preview-text');
    expect(container.querySelector('pre')?.textContent).toBe('line 1\n  line 2');
  });

  it('檔案太大被截斷 → 顯示提示且不嘗試排版', async () => {
    fetchFileText.mockResolvedValue({ text: '{"a":1}', truncated: true });
    renderWithPermissions(<TextPreview file={file} />);
    expect(await screen.findByTestId('file-preview-truncated')).toBeInTheDocument();
    expect(screen.getByTestId('file-preview-text').querySelector('pre')?.textContent).toBe(
      '{"a":1}',
    );
  });

  it('讀取失敗 → 顯示錯誤訊息', async () => {
    fetchFileText.mockRejectedValue(new AppError('FILE_NOT_FOUND', 404));
    renderWithPermissions(<TextPreview file={file} />);
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId('file-preview-text')).not.toBeInTheDocument();
  });

  it('沒有網址時不讀取，維持載入中', () => {
    renderWithPermissions(<TextPreview file={{ ...file, url: null }} />);
    expect(fetchFileText).not.toHaveBeenCalled();
    expect(screen.queryByTestId('file-preview-text')).not.toBeInTheDocument();
  });
});
