import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileFolder } from '@/shared/api-sdk';
import { renderWithPermissions } from '@/test/renderWithPermissions';

import { FileMoveDialog } from '../components/FileMoveDialog';
import { buildFolderIndex } from '../folderTree';

const CAN_ALL = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canShare: true,
};

function folder(id: string, name: string, parentId: string | null = null): FileFolder {
  return {
    id,
    name,
    parentId,
    kind: 'normal',
    inheritGrants: true,
    hasPendingAccessRequest: false,
    capabilities: CAN_ALL,
    tags: [],
    createdAt: '',
    updatedAt: '',
  };
}

const FOLDERS = buildFolderIndex(
  [folder('a', 'Art'), folder('b', 'Brushes', 'a'), folder('c', 'Concepts')],
  { canCreate: true },
);
/** 把根目錄底下的 Art 移走：Art 與它的子孫不能當目的地。 */
const MOVE_ART = { fileIds: [], folderIds: ['a'], sourceFolderId: undefined };

const byValue = (testId: string, value: string) =>
  screen
    .getAllByTestId(testId)
    .find((element) => element.getAttribute('data-value') === value) as HTMLElement;

describe('FileMoveDialog', () => {
  it('以樹狀下拉選單選目的地；要移動的資料夾與子孫停用', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    renderWithPermissions(
      <FileMoveDialog
        items={MOVE_ART}
        folders={FOLDERS}
        pending={false}
        onMove={onMove}
        onClose={() => undefined}
      />,
    );

    // 目前位置可以選，但不能「移到這裡」
    expect(await screen.findByTestId('file-move-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('file-move-target'));
    await screen.findByRole('tree');
    expect(byValue('select-item', 'a')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(byValue('select-item', 'c'));

    await waitFor(() => expect(screen.getByTestId('file-move-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('file-move-submit'));
    expect(onMove).toHaveBeenCalledWith(MOVE_ART, 'c');
  });

  it('資料夾樹預設收合；展開後與下拉選單是同一個目的地', async () => {
    renderWithPermissions(
      <FileMoveDialog
        items={MOVE_ART}
        folders={FOLDERS}
        pending={false}
        onMove={vi.fn()}
        onClose={() => undefined}
      />,
    );

    expect(await screen.findByTestId('file-move-target')).toBeInTheDocument();
    expect(screen.queryByTestId('file-move-tree')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('file-move-tree-toggle'));
    expect(await screen.findByTestId('file-move-tree')).toBeInTheDocument();
    expect(byValue('file-folder-tree-item', 'a')).toBeDisabled();

    fireEvent.click(byValue('file-folder-tree-item', 'c'));
    expect(byValue('file-folder-tree-item', 'c')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('file-move-target')).toHaveTextContent('Concepts');
    expect(screen.getByTestId('file-move-submit')).toBeEnabled();
  });
});
