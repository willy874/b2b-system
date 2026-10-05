import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileViewMode } from '../../../preference';
import type { BrowserItemVM, FileItemVM, FolderItemVM } from '../adapter';
import { FileBrowser } from '../components/FileBrowser';
import { buildFolderIndex } from '../folderTree';
import { useFileSelection } from '../useFileSelection';
import { ITEM_DRAG_TYPE, useItemDrag } from '../useItemDrag';

const item = (id: string, overrides: Partial<FileItemVM> = {}): FileItemVM => ({
  type: 'file',
  id,
  name: `${id}.png`,
  contentType: 'image/png',
  kind: 'image',
  icon: 'file-image',
  size: 10,
  sizeLabel: '10 B',
  previewUrl: null,
  displayUrl: null,
  url: null,
  downloadUrl: null,
  version: 1,
  uploaderName: 'Alice',
  canUpdate: true,
  canDelete: true,
  tags: [],
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  ...overrides,
});

const folder = (id: string, overrides: Partial<FolderItemVM> = {}): FolderItemVM => ({
  type: 'folder',
  id,
  name: `folder-${id}`,
  parentId: null,
  kind: 'normal',
  folderCount: 0,
  canRead: true,
  hasPendingAccessRequest: false,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canShare: false,
  tags: [],
  updatedAt: '2026-09-27T00:00:00.000Z',
  ...overrides,
});

const ITEMS = [item('a'), item('b'), item('c'), item('d')];

/** 主區塊裡所有的項目（資料夾在前）。 */
const all = () => [
  ...screen.queryAllByTestId('file-folder-item'),
  ...screen.queryAllByTestId('file-item'),
];

/** 頁面內拖曳的 dataTransfer（jsdom 沒有 DataTransfer）。 */
const itemDataTransfer = () => ({
  types: [ITEM_DRAG_TYPE],
  setData: vi.fn(),
  setDragImage: vi.fn(),
  effectAllowed: '',
  dropEffect: '',
});

function setup(
  options: {
    items?: BrowserItemVM[];
    viewMode?: FileViewMode;
    canUpload?: boolean;
    canMove?: boolean;
  } = {},
) {
  const items = options.items ?? ITEMS;
  const selection = renderHook(() => useFileSelection(items.map((file) => file.id)));
  const onMove = vi.fn();
  const folders = buildFolderIndex(
    items
      .filter((entry) => entry.type === 'folder')
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        parentId: null,
        kind: 'normal' as const,
        inheritGrants: true,
        hasPendingAccessRequest: false,
        capabilities: {
          canRead: entry.canRead,
          canCreate: entry.canCreate,
          canUpdate: entry.canUpdate,
          canDelete: entry.canDelete,
          canShare: entry.canShare,
        },
        tags: [],
        createdAt: '',
        updatedAt: '',
      })),
    { canCreate: true },
  );
  const drag = renderHook(() => useItemDrag({ enabled: options.canMove ?? true, folders, onMove }));
  const props = {
    onOpen: vi.fn(),
    onDeleteSelected: vi.fn(),
    onDropUpload: vi.fn(),
    onSortChange: vi.fn(),
  };
  const view = () => (
    <FileBrowser
      items={items}
      viewMode={options.viewMode ?? 'grid'}
      selection={selection.result.current}
      loading={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={vi.fn()}
      onStaleUrl={vi.fn()}
      canUpload={options.canUpload ?? true}
      currentFolderId={undefined}
      itemDrag={drag.result.current}
      canMove={options.canMove ?? true}
      canUploadInto={(folderId) =>
        items.some((entry) => entry.id === folderId && entry.type === 'folder' && entry.canCreate)
      }
      sort={{ sort: 'createdAt', order: 'desc' }}
      emptyContent={<p data-testid="empty">empty</p>}
      {...props}
    />
  );
  const rendered = renderWithPermissions(view());
  const rerender = () => rendered.rerender(view());
  const selected = () =>
    all()
      .filter((element) => element.getAttribute('aria-selected') === 'true')
      .map((element) => element.dataset.value);
  const itemEl = (id: string) =>
    all().find((element) => element.dataset.value === id) as HTMLElement;
  const act$ = (fn: () => void) => {
    act(fn);
    rerender();
  };
  return { ...props, onMove, selection, rerender, selected, itemEl, act$ };
}

describe('FileBrowser（主區塊）', () => {
  it('點擊只選一個；Ctrl 點擊加選；Shift 點擊選範圍', () => {
    const { itemEl, selected, act$ } = setup();
    act$(() => fireEvent.click(itemEl('a')));
    expect(selected()).toEqual(['a']);
    act$(() => fireEvent.click(itemEl('c'), { ctrlKey: true }));
    expect(selected()).toEqual(['a', 'c']);
    act$(() => fireEvent.click(itemEl('b')));
    act$(() => fireEvent.click(itemEl('d'), { shiftKey: true }));
    expect(selected()).toEqual(['b', 'c', 'd']);
  });

  it('點勾選框是切換（不會取消其他選取）', () => {
    const { itemEl, selected, act$ } = setup();
    act$(() => fireEvent.click(itemEl('a')));
    const checkbox = itemEl('c').querySelector('[data-testid="file-item-checkbox"]');
    act$(() => fireEvent.click(checkbox as Element));
    expect(selected()).toEqual(['a', 'c']);
  });

  it('雙擊打開 LightBox', () => {
    const { itemEl, onOpen } = setup();
    fireEvent.doubleClick(itemEl('b'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', type: 'file' }));
  });

  it('鍵盤：Ctrl+A 全選、Esc 清除、Delete 要求刪除選取、Enter 打開焦點項目', () => {
    const { selected, act$, onDeleteSelected, onOpen } = setup();
    const list = screen.getByRole('listbox');
    act$(() => fireEvent.keyDown(list, { key: 'a', ctrlKey: true }));
    expect(selected()).toEqual(['a', 'b', 'c', 'd']);
    fireEvent.keyDown(list, { key: 'Delete' });
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    act$(() => fireEvent.keyDown(list, { key: 'Escape' }));
    expect(selected()).toEqual([]);

    act$(() => fireEvent.keyDown(list, { key: 'ArrowRight' }));
    expect(selected()).toEqual(['a']);
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('拖放檔案：出現遮罩，放開後交出檔案（目的地是目前的資料夾）', async () => {
    const { onDropUpload } = setup();
    const browser = screen.getByTestId('file-browser');
    const file = new File(['x'], 'a.txt');
    const dataTransfer = {
      types: ['Files'],
      files: [file],
      items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => null }],
    };
    fireEvent.dragEnter(browser, { dataTransfer });
    expect(screen.getByTestId('file-drop-overlay')).toBeInTheDocument();
    fireEvent.drop(browser, { dataTransfer });
    await waitFor(() =>
      expect(onDropUpload).toHaveBeenCalledWith(
        { entries: [{ file, directories: [] }], directories: [] },
        undefined,
      ),
    );
    expect(screen.queryByTestId('file-drop-overlay')).not.toBeInTheDocument();
  });

  it('從電腦拖檔案放在資料夾卡片上：上傳到那個資料夾', async () => {
    const { onDropUpload, itemEl } = setup({ items: [folder('f1'), item('a')] });
    const file = new File(['x'], 'a.txt');
    const dataTransfer = {
      types: ['Files'],
      files: [file],
      items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => null }],
    };
    fireEvent.dragEnter(itemEl('f1'), { dataTransfer });
    fireEvent.dragOver(itemEl('f1'), { dataTransfer });
    expect(screen.getByTestId('file-drop-overlay').dataset.value).toBe('f1');
    fireEvent.drop(itemEl('f1'), { dataTransfer });
    await waitFor(() => expect(onDropUpload).toHaveBeenCalledWith(expect.anything(), 'f1'));
  });

  it('沒有上傳權限：拖曳檔案不出現遮罩、不交出檔案', () => {
    const { onDropUpload } = setup({ canUpload: false });
    const browser = screen.getByTestId('file-browser');
    const dataTransfer = { types: ['Files'], files: [new File(['x'], 'a.txt')], items: [] };
    fireEvent.dragEnter(browser, { dataTransfer });
    expect(screen.queryByTestId('file-drop-overlay')).not.toBeInTheDocument();
    fireEvent.drop(browser, { dataTransfer });
    expect(onDropUpload).not.toHaveBeenCalled();
  });

  it('資料夾排在前面；雙擊資料夾是開啟（進入）', () => {
    const { itemEl, onOpen } = setup({ items: [folder('f1'), item('a')] });
    fireEvent.doubleClick(itemEl('f1'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', type: 'folder' }));
  });

  describe('拖曳項目到資料夾上移動（docs/architecture/frontend/12-file-manager.md §12）', () => {
    it('拖已選取的項目：整批（檔案與資料夾）移到放下的資料夾', () => {
      const { itemEl, act$, onMove } = setup({
        items: [folder('f1'), folder('f2'), item('a'), item('b')],
      });
      act$(() => fireEvent.click(itemEl('f2')));
      act$(() => fireEvent.click(itemEl('a'), { ctrlKey: true }));
      const dataTransfer = itemDataTransfer();
      fireEvent.dragStart(itemEl('a'), { dataTransfer });
      fireEvent.dragOver(itemEl('f1'), { dataTransfer });
      expect(dataTransfer.dropEffect).toBe('move');
      fireEvent.drop(itemEl('f1'), { dataTransfer });

      expect(onMove).toHaveBeenCalledWith(
        { fileIds: ['a'], folderIds: ['f2'], sourceFolderId: undefined },
        'f1',
      );
    });

    it('拖沒選取的項目：只拖它', () => {
      const { itemEl, act$, onMove } = setup({ items: [folder('f1'), item('a'), item('b')] });
      act$(() => fireEvent.click(itemEl('a')));
      const dataTransfer = itemDataTransfer();
      fireEvent.dragStart(itemEl('b'), { dataTransfer });
      fireEvent.drop(itemEl('f1'), { dataTransfer });
      expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ fileIds: ['b'] }), 'f1');
    });

    it('資料夾不能放進自己：游標顯示禁止、不移動', () => {
      const { itemEl, onMove } = setup({ items: [folder('f1'), item('a')] });
      const dataTransfer = itemDataTransfer();
      fireEvent.dragStart(itemEl('f1'), { dataTransfer });
      fireEvent.dragOver(itemEl('f1'), { dataTransfer });
      expect(dataTransfer.dropEffect).toBe('none');
      fireEvent.drop(itemEl('f1'), { dataTransfer });
      expect(onMove).not.toHaveBeenCalled();
    });

    it('沒有移動權限：項目不可拖曳', () => {
      const { itemEl } = setup({ items: [folder('f1'), item('a')], canMove: false });
      expect(itemEl('a').getAttribute('draggable')).toBe('false');
      expect(itemEl('f1').getAttribute('draggable')).toBe('false');
    });
  });

  it('列表模式有表頭，點欄名排序', () => {
    const { onSortChange } = setup({ viewMode: 'list' });
    expect(screen.getByTestId('file-list-header')).toBeInTheDocument();
    const nameHeader = screen
      .getAllByTestId('file-sort-header')
      .find((element) => element.dataset.value === 'name');
    fireEvent.click(nameHeader as Element);
    expect(onSortChange).toHaveBeenCalledWith({ sort: 'name', order: 'asc' });
  });

  it('沒有檔案時顯示空狀態', () => {
    setup({ items: [] });
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });

  it('鎖住的資料夾顯示鎖頭與「沒有存取權」', () => {
    setup({ items: [folder('locked', { canRead: false, canCreate: false }), folder('open')] });
    const [locked, open] = screen.getAllByTestId('file-folder-item');
    expect(locked).toHaveAttribute('data-locked', 'true');
    expect(open).not.toHaveAttribute('data-locked');
    expect(screen.getAllByTestId('file-folder-locked')).toHaveLength(1);
  });
});
