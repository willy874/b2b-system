import { renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { lazy } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFileAction, resetFileRegistry } from '@/core/file';
import type { FileActionDefinition, FileActionDialogProps, FileActionTarget } from '@/core/file';
import type { PermissionKey } from '@/core/permission';

import { FileSelectionBar } from '../components/FileSelectionBar';

const file = (id: string, contentType = 'image/png'): FileActionTarget => ({
  id,
  name: `${id}.png`,
  contentType,
  size: 1,
});

const ActionDialog = vi.fn(({ files, skipped, sourceId, onClose }: FileActionDialogProps) => (
  <div data-testid="test-action-dialog">
    <span data-testid="test-action-files">{files.map((entry) => entry.id).join(',')}</span>
    <span data-testid="test-action-skipped">
      {skipped.map((entry) => `${entry.file.id}:${entry.reasonKey}`).join(',')}
    </span>
    <span data-testid="test-action-source">{sourceId}</span>
    <button type="button" onClick={onClose} data-testid="test-action-close">
      close
    </button>
  </div>
));

const imageOnly: FileActionDefinition['check'] = (target) =>
  target.contentType.startsWith('image/')
    ? { ok: true }
    : { ok: false, reasonKey: 'test.notImage', params: { name: target.name } };

function register(overrides: Partial<FileActionDefinition> = {}) {
  return registerFileAction({
    id: 'gallery.add',
    labelKey: 'test.galleryAdd',
    icon: 'file-image',
    placement: ['selectionBar'],
    check: imageOnly,
    component: ActionDialog,
    ...overrides,
  });
}

const noop = () => {};

function bar(files: readonly FileActionTarget[], count = files.length) {
  return (
    <FileSelectionBar
      count={count}
      total={10}
      files={files}
      canDownload={files.length > 0}
      canDelete
      canRename={false}
      canTag={false}
      canMove
      canShare={false}
      canRequestAccess={false}
      onSelectAll={noop}
      onClear={noop}
      onDownload={noop}
      onDelete={noop}
      onRename={noop}
      onTag={noop}
      onMove={noop}
      onShare={noop}
      onRequestAccess={noop}
    />
  );
}

const actionButtons = () => screen.queryAllByTestId('file-selection-action');

beforeEach(() => {
  resetFileRegistry();
  ActionDialog.mockClear();
});

describe('FileSelectionBar 的檔案動作（core/file 的 registerFileAction，docs/architecture/frontend/12-file-manager.md §6.2）', () => {
  it('沒有登記的動作 → 與原本相同（只有內建按鈕）', () => {
    renderWithPermissions(bar([file('a')]));
    expect(screen.getByTestId('file-selection-delete')).toBeInTheDocument();
    expect(actionButtons()).toHaveLength(0);
  });

  it('有動作時列在內建按鈕之後，依 order 排序；只登記在 LightBox 的不出現', () => {
    register({ id: 'b', order: 2 });
    register({ id: 'a', order: 1 });
    register({ id: 'lightbox-only', placement: ['lightbox'] });
    renderWithPermissions(bar([file('x')]));
    const buttons = actionButtons();
    expect(buttons.map((button) => button.getAttribute('data-value'))).toEqual(['a', 'b']);
    const deleteButton = screen.getByTestId('file-selection-delete');
    expect(
      deleteButton.compareDocumentPosition(buttons[0] as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('選取裡沒有檔案（只有資料夾）→ 不顯示動作', () => {
    register();
    renderWithPermissions(bar([], 2));
    expect(screen.getByTestId('file-selection-count')).toBeInTheDocument();
    expect(actionButtons()).toHaveLength(0);
  });

  it('權限：有 → 顯示／無 → 不顯示／未水合 → 不閃現', () => {
    register({ isAvailable: ({ can }) => can('file:read' as PermissionKey) });
    const { unmount } = renderWithPermissions(bar([file('a')]), ['file:read' as PermissionKey]);
    expect(actionButtons()).toHaveLength(1);
    unmount();

    const denied = renderWithPermissions(bar([file('a')]), []);
    expect(actionButtons()).toHaveLength(0);
    denied.unmount();

    renderUnhydrated(bar([file('a')]));
    expect(actionButtons()).toHaveLength(0);
  });

  it('全部不通過 check → 停用，按了沒反應', () => {
    register();
    renderWithPermissions(bar([file('a', 'text/plain'), file('b', 'application/pdf')]));
    const [button] = actionButtons();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button as HTMLElement);
    expect(screen.queryByTestId('test-action-dialog')).toBeNull();
  });

  it('部分通過 → 可以按；元件收到通過的 files、略過的 skipped 與檔案管理器的 sourceId', async () => {
    register();
    renderWithPermissions(bar([file('a'), file('b', 'text/plain'), file('c')]));
    const [button] = actionButtons();
    expect(button).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button as HTMLElement);

    expect(await screen.findByTestId('test-action-files')).toHaveTextContent('a,c');
    expect(screen.getByTestId('test-action-skipped')).toHaveTextContent('b:test.notImage');
    expect(screen.getByTestId('test-action-source')).toHaveTextContent('file');
    expect(ActionDialog.mock.lastCall?.[0].skipped).toEqual([
      { file: file('b', 'text/plain'), reasonKey: 'test.notImage', params: { name: 'b.png' } },
    ]);

    fireEvent.click(screen.getByTestId('test-action-close'));
    await waitFor(() => expect(screen.queryByTestId('test-action-dialog')).toBeNull());
  });

  it('沒有 check → 全部交給動作', () => {
    register({ check: undefined });
    renderWithPermissions(bar([file('a'), file('b', 'text/plain')]));
    fireEvent.click(actionButtons()[0] as HTMLElement);
    expect(screen.getByTestId('test-action-files')).toHaveTextContent('a,b');
  });

  it('lazy 的元件：包在 Suspense 裡，載入後顯示', async () => {
    register({
      component: lazy(() => Promise.resolve({ default: ActionDialog })),
    });
    renderWithPermissions(bar([file('a')]));
    fireEvent.click(actionButtons()[0] as HTMLElement);
    expect(await screen.findByTestId('test-action-dialog')).toBeInTheDocument();
  });

  it('feature 卸載（反註冊）後按鈕消失', async () => {
    const dispose = register();
    renderWithPermissions(bar([file('a')]));
    expect(actionButtons()).toHaveLength(1);
    dispose();
    await waitFor(() => expect(actionButtons()).toHaveLength(0));
  });
});
