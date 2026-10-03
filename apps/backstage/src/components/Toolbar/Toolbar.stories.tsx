import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { fn } from 'storybook/test';

import { Icon } from '../Icon';
import { TooltipProvider } from '../Tooltip';
import { Toolbar } from './Toolbar';
import type { ToolbarItem } from './Toolbar';

const items: ToolbarItem[] = [
  { key: 'add', label: '新增', icon: <Icon name="plus" size={16} />, onClick: fn() },
  {
    key: 'folder',
    label: '新增資料夾',
    icon: <Icon name="folder-plus" size={16} />,
    onClick: fn(),
  },
  { key: 'upload', label: '上傳', icon: <Icon name="upload" size={16} />, onClick: fn() },
  {
    key: 'delete',
    label: '刪除',
    icon: <Icon name="trash" size={16} />,
    variant: 'danger',
    onClick: fn(),
  },
  {
    key: 'undo',
    label: '復原',
    icon: <Icon name="undo" size={16} />,
    iconOnly: true,
    align: 'end',
    onClick: fn(),
  },
  {
    key: 'redo',
    label: '重做',
    icon: <Icon name="redo" size={16} />,
    iconOnly: true,
    disabled: true,
    tooltip: '沒有可重做的步驟',
    align: 'end',
  },
  {
    key: 'refresh',
    label: '重新整理',
    icon: <Icon name="refresh" size={16} />,
    iconOnly: true,
    align: 'end',
    onClick: fn(),
  },
];

/** 可拖曳右下角調整寬度，看按鈕依序縮成圖示、收進「更多」。 */
function Resizable({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div
      className="overflow-auto resize-x border border-dashed border-border p-2"
      style={{ width, minWidth: 80, maxWidth: '100%' }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: 'Components/Toolbar',
  component: Toolbar,
  args: { items, 'aria-label': '檔案操作' },
  decorators: [
    (Story) => (
      <TooltipProvider delay={200}>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Resizable width={720}>
      <Toolbar {...args} />
    </Resizable>
  ),
};

/** `iconOnly={560}`：寬度小於 560px 時先縮成只剩圖示，仍放不下的才收進下拉。 */
export const IconOnlyBreakpoint: Story = {
  args: { iconOnly: 560 },
  render: (args) => (
    <Resizable width={480}>
      <Toolbar {...args} />
    </Resizable>
  ),
};

/** 窄容器：放不下的按鈕從尾端收進「更多」。 */
export const Narrow: Story = {
  render: (args) => (
    <Resizable width={240}>
      <Toolbar {...args} />
    </Resizable>
  ),
};
