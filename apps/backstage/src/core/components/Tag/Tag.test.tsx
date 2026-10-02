import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Tag } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';
import { AllProviders } from '@/test/renderWithPermissions';

import { TagAssignDialog } from './TagAssignDialog';
import { TagChips } from './TagChips';

beforeAll(() => initTestI18n());

const tag = (id: string, name: string, color: Tag['color'] = 'neutral'): Tag => ({
  id,
  scope: 'file',
  name,
  color,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('TagChips（docs/architecture/backend/18-tag.md §7.2 D3）', () => {
  it('每個標籤一個 chip，顏色對到 tone；超過 max 收成 +N', () => {
    render(
      <TagChips tags={[tag('a', '合約', 'warning'), tag('b', '急件'), tag('c', '草稿')]} max={2} />,
      {
        wrapper: AllProviders,
      },
    );
    expect(screen.getAllByTestId('tag-chip').map((chip) => chip.dataset.value)).toEqual(['a', 'b']);
    expect(screen.getByTestId('tag-chip-more')).toHaveTextContent('+1');
  });

  it('沒有標籤時顯示 empty', () => {
    render(<TagChips tags={[]} empty="-" />, { wrapper: AllProviders });
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('TagAssignDialog', () => {
  it('從目前的標籤開始；送出整批取代並關閉', async () => {
    const onSave = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    render(
      <TagAssignDialog
        open
        onOpenChange={onOpenChange}
        title="標籤：a.pdf"
        options={[tag('a', '合約'), tag('b', '急件')]}
        value={[tag('a', '合約')]}
        onSave={onSave}
      />,
      { wrapper: AllProviders },
    );
    fireEvent.click(screen.getByTestId('tag-assign-select'));
    fireEvent.click(await screen.findByRole('option', { name: '急件' }));
    fireEvent.click(screen.getByTestId('tag-assign-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(['a', 'b']));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('送出失敗：留在對話框並顯示訊息', async () => {
    render(
      <TagAssignDialog
        open
        onOpenChange={vi.fn()}
        title="標籤"
        options={[tag('a', '合約')]}
        value={[]}
        onSave={vi.fn(async () => {
          throw new Error('boom');
        })}
      />,
      { wrapper: AllProviders },
    );
    fireEvent.click(screen.getByTestId('tag-assign-save'));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
  });

  it('這個標籤組還沒有標籤：說明要先建立', () => {
    render(
      <TagAssignDialog
        open
        onOpenChange={vi.fn()}
        title="標籤"
        options={[]}
        value={[]}
        onSave={vi.fn()}
      />,
      { wrapper: AllProviders },
    );
    expect(screen.getByTestId('tag-assign-empty')).toBeInTheDocument();
  });
});
