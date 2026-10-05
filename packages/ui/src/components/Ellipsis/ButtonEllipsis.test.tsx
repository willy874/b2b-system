import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../testing/fakeLayout';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { TooltipProvider } from '../Tooltip';
import { ButtonEllipsis } from './index';
import type { ButtonEllipsisItem, ButtonEllipsisProps } from './index';

let layout: ReturnType<typeof installFakeLayout>;
const onCreate = vi.fn();
const onImport = vi.fn();
const onDelete = vi.fn();

const ITEMS: ButtonEllipsisItem[] = [
  {
    key: 'create',
    label: '新增',
    icon: <Icon name="plus" size={16} />,
    onClick: onCreate,
    'data-testid': 'btn-create',
  },
  {
    key: 'import',
    label: '匯入',
    icon: <Icon name="upload" size={16} />,
    onClick: onImport,
    'data-testid': 'btn-import',
  },
  {
    key: 'delete',
    label: '刪除',
    variant: 'danger',
    onClick: onDelete,
    'data-testid': 'btn-delete',
  },
];

beforeEach(() => {
  layout = installFakeLayout();
  for (const id of ['btn-create', 'btn-import', 'btn-delete']) layout.setSize(id, { width: 80 });
  layout.setSize('button-ellipsis-more', { width: 36 });
});

afterEach(() => {
  layout.restore();
  vi.clearAllMocks();
});

function renderGroup(props: Partial<ButtonEllipsisProps> = {}) {
  return render(
    <TooltipProvider delay={0}>
      <ButtonEllipsis data-testid="group" items={ITEMS} {...props} />
    </TooltipProvider>,
  );
}

describe('ButtonEllipsis', () => {
  it('寬度足夠時全部顯示成按鈕，沒有「更多」', () => {
    layout.setSize('group', { clientWidth: 400 });
    renderGroup();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
  });

  it('放不下的按鈕收進下拉，選項可觸發原本的 onClick', async () => {
    layout.setSize('group', { clientWidth: 200 });
    renderGroup();
    // 80 + 80 + 36 = 196
    expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '匯入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '更多' }));
    const option = await screen.findByRole('menuitem', { name: '刪除' });
    expect(option).toHaveAttribute('data-tone', 'danger');
    await userEvent.click(option);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('maxVisible={0} 時全部收進下拉', async () => {
    layout.setSize('group', { clientWidth: 400 });
    renderGroup({ maxVisible: 0 });
    await userEvent.click(screen.getByRole('button', { name: '更多' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['新增', '匯入', '刪除']);
  });

  it('iconOnly 判斷點：容器變窄時有圖示的按鈕只剩圖示，名稱不變、hover 顯示文字', async () => {
    layout.setSize('group', { clientWidth: 400 });
    renderGroup({ iconOnly: 300 });
    expect(screen.getByTestId('btn-create')).toHaveTextContent('新增');

    layout.setSize('group', { clientWidth: 280 });
    layout.resize();
    const create = screen.getByRole('button', { name: '新增' });
    expect(create).not.toHaveTextContent('新增');
    // 沒有圖示的項目仍顯示文字
    expect(screen.getByTestId('btn-delete')).toHaveTextContent('刪除');

    await userEvent.hover(create);
    expect(await screen.findByText('新增')).toBeVisible();
    await userEvent.click(create);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('renderMoreTrigger 自訂下拉按鈕，會收到被隱藏的項目', async () => {
    layout.setSize('group', { clientWidth: 400 });
    renderGroup({
      maxVisible: 1,
      renderMoreTrigger: (hidden) => <Button>其他 {hidden.length} 項</Button>,
    });
    await userEvent.click(screen.getByRole('button', { name: '其他 2 項' }));
    expect(await screen.findByRole('menuitem', { name: '匯入' })).toBeInTheDocument();
  });

  it('按鈕預設 data-testid 為 button-ellipsis-item ＋ data-value', () => {
    layout.setSize('group', { clientWidth: 400 });
    render(
      <TooltipProvider>
        <ButtonEllipsis items={[{ key: 'save', label: '儲存' }]} variant="primary" size="sm" />
      </TooltipProvider>,
    );
    const button = screen.getByRole('button', { name: '儲存' });
    expect(button).toHaveAttribute('data-testid', 'button-ellipsis-item');
    expect(button).toHaveAttribute('data-value', 'save');
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'sm');
  });
});
