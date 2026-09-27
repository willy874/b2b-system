import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPermissions } from '@/test/renderWithPermissions';

import type { FileViewMode } from '../../../preference';
import type { FileItemVM } from '../adapter';
import { FileBrowser } from '../components/FileBrowser';
import { useFileSelection } from '../useFileSelection';

const item = (id: string, overrides: Partial<FileItemVM> = {}): FileItemVM => ({
  id,
  name: `${id}.png`,
  contentType: 'image/png',
  kind: 'image',
  icon: 'file-image',
  size: 10,
  sizeLabel: '10 B',
  previewUrl: null,
  url: null,
  downloadUrl: null,
  version: 1,
  uploaderName: 'Alice',
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  ...overrides,
});

const ITEMS = [item('a'), item('b'), item('c'), item('d')];

function setup(
  options: { items?: FileItemVM[]; viewMode?: FileViewMode; canUpload?: boolean } = {},
) {
  const items = options.items ?? ITEMS;
  const selection = renderHook(() => useFileSelection(items.map((file) => file.id)));
  const props = {
    onOpen: vi.fn(),
    onDeleteSelected: vi.fn(),
    onDropFiles: vi.fn(),
    onDropDirectories: vi.fn(),
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
      sort={{ sort: 'createdAt', order: 'desc' }}
      emptyContent={<p data-testid="empty">empty</p>}
      {...props}
    />
  );
  const rendered = renderWithPermissions(view());
  const rerender = () => rendered.rerender(view());
  const selected = () =>
    screen
      .getAllByTestId('file-item')
      .filter((element) => element.getAttribute('aria-selected') === 'true')
      .map((element) => element.dataset.value);
  const itemEl = (id: string) =>
    screen
      .getAllByTestId('file-item')
      .find((element) => element.dataset.value === id) as HTMLElement;
  const act$ = (fn: () => void) => {
    act(fn);
    rerender();
  };
  return { ...props, selection, rerender, selected, itemEl, act$ };
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
    expect(onOpen).toHaveBeenCalledWith('b');
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
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('拖放檔案：出現遮罩，放開後交出檔案、略過資料夾', () => {
    const { onDropFiles, onDropDirectories } = setup();
    const browser = screen.getByTestId('file-browser');
    const file = new File(['x'], 'a.txt');
    const dataTransfer = {
      types: ['Files'],
      files: [file],
      items: [
        { kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) },
        { kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true }) },
      ],
    };
    fireEvent.dragEnter(browser, { dataTransfer });
    expect(screen.getByTestId('file-drop-overlay')).toBeInTheDocument();
    fireEvent.drop(browser, { dataTransfer });
    expect(onDropFiles).toHaveBeenCalledWith([file]);
    expect(onDropDirectories).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('file-drop-overlay')).not.toBeInTheDocument();
  });

  it('沒有上傳權限：拖曳檔案不出現遮罩、不交出檔案', () => {
    const { onDropFiles } = setup({ canUpload: false });
    const browser = screen.getByTestId('file-browser');
    const dataTransfer = { types: ['Files'], files: [new File(['x'], 'a.txt')], items: [] };
    fireEvent.dragEnter(browser, { dataTransfer });
    expect(screen.queryByTestId('file-drop-overlay')).not.toBeInTheDocument();
    fireEvent.drop(browser, { dataTransfer });
    expect(onDropFiles).not.toHaveBeenCalled();
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
});
