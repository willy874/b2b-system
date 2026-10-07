import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileFolder } from '@/shared/api-sdk';

import { FileBreadcrumb } from '../components/FileBreadcrumb';
import type { ItemDrag } from '../useItemDrag';

/** jsdom 不排版：每一層（含「…」）都當成 100px 寬，容器寬度由各案例決定。 */
const LEVEL_WIDTH = 100;

const PATH = ['a', 'b', 'c', 'd'].map(
  (id) => ({ id, name: `folder-${id}` }) as unknown as FileFolder,
);

const fakeItemDrag = (isDragging = false): ItemDrag => ({
  isDragging,
  isOver: () => false,
  startDrag: vi.fn(),
  endDrag: vi.fn(),
  dropHandlers: { onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() },
});

/** 顯示中的層的 id（根目錄是 `root`；不含量寬度用的隱藏副本）。 */
const shownLevels = () =>
  within(screen.getByRole('list'))
    .queryAllByTestId('file-breadcrumb-item')
    .map((el) => el.dataset.value);

const renderBreadcrumb = (itemDrag = fakeItemDrag(), onNavigate = vi.fn()) =>
  renderWithPermissions(<FileBreadcrumb path={PATH} onNavigate={onNavigate} itemDrag={itemDrag} />);

describe('FileBreadcrumb（docs/architecture/frontend/12-file-manager.md §3）', () => {
  let available = 1000;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(LEVEL_WIDTH);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available);
    // 觀察開始時回呼一次，等同瀏覽器第一次量到尺寸
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('放得下時顯示完整路徑，沒有「…」', () => {
    available = 1000;
    renderBreadcrumb();
    expect(shownLevels()).toEqual(['root', 'a', 'b', 'c', 'd']);
    expect(screen.queryByTestId('file-breadcrumb-collapsed')).toBeNull();
  });

  it('放不下時保留根目錄與目前位置，中間收進「…」', () => {
    // 根目錄 ＋「…」＋ 最後兩層 = 400
    available = 420;
    renderBreadcrumb();
    expect(shownLevels()).toEqual(['root', 'c', 'd']);
    expect(screen.getByTestId('file-breadcrumb-collapsed')).toBeInTheDocument();
  });

  it('「…」選單列出被收起的層，點了就前往該層', async () => {
    available = 420;
    const onNavigate = vi.fn();
    renderBreadcrumb(fakeItemDrag(), onNavigate);
    fireEvent.click(screen.getByTestId('file-breadcrumb-collapsed'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['folder-a', 'folder-b']);
    // 選單裡的每一層也是放置目標
    expect(items[0]).toHaveAttribute('data-drop-folder', 'a');
    fireEvent.click(items[1] as HTMLElement);
    expect(onNavigate).toHaveBeenCalledWith('b');
  });

  it('拖曳中停在「…」上一段時間自動展開，拖曳結束就收起', async () => {
    available = 420;
    vi.useFakeTimers();
    const view = renderBreadcrumb(fakeItemDrag(true));
    fireEvent.dragEnter(screen.getByTestId('file-breadcrumb-collapsed'));
    expect(screen.queryByRole('menuitem')).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    vi.useRealTimers();
    expect(await screen.findAllByRole('menuitem')).toHaveLength(2);

    view.rerender(<FileBreadcrumb path={PATH} onNavigate={vi.fn()} itemDrag={fakeItemDrag()} />);
    await vi.waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  });

  it('沒在拖曳時滑過「…」不會展開', () => {
    available = 420;
    vi.useFakeTimers();
    renderBreadcrumb();
    fireEvent.dragEnter(screen.getByTestId('file-breadcrumb-collapsed'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
