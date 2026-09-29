import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithPermissions } from '@/test/renderWithPermissions';

import { ImagePreview } from '../ImagePreview';

const file = {
  id: 'f1',
  name: 'hero.png',
  contentType: 'image/png',
  size: 10,
  url: 'http://s/f1?inline',
  displayUrl: '/api/files/f1/image/preview?sig',
};

describe('ImagePreview', () => {
  it('預設顯示全螢幕預覽；切到原始大小才載入原圖', async () => {
    renderWithPermissions(<ImagePreview file={file} />);
    const image = screen.getByRole('img', { name: 'hero.png' });
    expect(image).toHaveAttribute('src', file.displayUrl);

    await userEvent.click(screen.getByTestId('file-preview-zoom'));
    expect(screen.getByRole('img', { name: 'hero.png' })).toHaveAttribute('src', file.url);
  });

  it('沒有全螢幕預覽時直接用原圖', () => {
    renderWithPermissions(<ImagePreview file={{ ...file, displayUrl: null }} />);
    expect(screen.getByRole('img', { name: 'hero.png' })).toHaveAttribute('src', file.url);
  });
});
