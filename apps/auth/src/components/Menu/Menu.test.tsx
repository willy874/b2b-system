import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeListLayout } from '@/test/fakeLayout';

import { Button } from '../Button';
import { Menu } from './index';

/** 以固定的 `data-testid` ＋ `data-value` 找元素（docs/conventions/06-literal-strings.md §3.3）。 */
function queryItem(value: string) {
  return document.querySelector<HTMLElement>(`[data-testid="menu-item"][data-value="${value}"]`);
}

function getItem(value: string) {
  const element = queryItem(value);
  if (!element) throw new Error(`找不到 menu-item（data-value="${value}"）`);
  return element;
}

const findItem = (value: string) => waitFor(() => getItem(value));

function renderMenu(onEdit = vi.fn(), onDelete = vi.fn()) {
  render(
    <Menu
      trigger={<Button>操作</Button>}
      items={[
        { key: 'edit', label: '編輯', onSelect: onEdit },
        { key: 'delete', label: '刪除', tone: 'danger', onSelect: onDelete, disabled: true },
      ]}
    />,
  );
  return { onEdit, onDelete };
}

const renderedCount = () => document.querySelectorAll('[data-testid="menu-item"]').length;

describe('Menu', () => {
  it('點擊觸發鈕後開啟選單', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('選取項目會觸發 onSelect', async () => {
    const { onEdit } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await userEvent.click(await findItem('edit'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('disabled 的項目不會觸發', async () => {
    const { onDelete } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await userEvent.click(await findItem('delete'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('tone 以 data-tone 屬性表現', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    expect(await findItem('delete')).toHaveAttribute('data-tone', 'danger');
    expect(getItem('edit')).toHaveAttribute('data-tone', 'default');
  });

  it('鍵盤可開啟，Esc 關閉後焦點回到觸發鈕', async () => {
    renderMenu();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作' })).toHaveFocus();
  });

  it('Esc 關閉選單', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('鍵盤開啟時作用列落在第一個可用項目，Enter 觸發並關閉', async () => {
    const { onEdit } = renderMenu();
    screen.getByRole('button', { name: '操作' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu).toHaveFocus());
    expect(menu).toHaveAttribute('aria-activedescendant', getItem('edit').id);

    await userEvent.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('render 的元素（連結）成為選單項目', async () => {
    render(
      <Menu
        trigger={<Button>操作</Button>}
        items={[{ key: 'docs', label: '文件', render: <a href="#docs">文件</a> }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    const link = await findItem('docs');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('role', 'menuitem');
    expect(link).toHaveAttribute('href', '#docs');
  });
});

describe('Menu（大量資料）', () => {
  let layout: ReturnType<typeof installFakeListLayout> | undefined;
  afterEach(() => {
    layout?.restore();
    layout = undefined;
  });

  const many = Array.from({ length: 2000 }, (_, index) => ({
    key: `item-${index}`,
    label: `Item ${index}`,
  }));

  it('超過門檻時只渲染可視範圍的項目，鍵盤 End 會捲到最後一項', async () => {
    layout = installFakeListLayout();
    render(<Menu trigger={<Button>操作</Button>} items={many} />);
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu).toHaveFocus());
    expect(renderedCount()).toBeLessThan(50);

    await userEvent.keyboard('{End}');
    await findItem('item-1999');
    expect(menu).toHaveAttribute('aria-activedescendant', getItem('item-1999').id);
  });

  it('無限捲動：內容不滿一屏時要下一頁，載入中顯示狀態且不重複要', async () => {
    const onLoadMore = vi.fn();
    const items = many.slice(0, 3);
    const { rerender } = render(
      <Menu trigger={<Button>操作</Button>} items={items} hasMore onLoadMore={onLoadMore} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '操作' }));
    await screen.findByRole('menu');
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <Menu
        trigger={<Button>操作</Button>}
        items={items}
        hasMore
        loading
        onLoadMore={onLoadMore}
      />,
    );
    expect(screen.getByRole('status', { name: '載入中…' })).toBeInTheDocument();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <Menu
        trigger={<Button>操作</Button>}
        items={many.slice(0, 6)}
        hasMore={false}
        onLoadMore={onLoadMore}
      />,
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(renderedCount()).toBe(6);
  });
});
