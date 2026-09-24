import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Icon } from '../Icon';
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from './Toolbar';

const meta = {
  title: 'Components/Toolbar',
  component: Toolbar,
  args: {
    'aria-label': '商品操作',
    children: (
      <>
        <ToolbarButton render={<Button variant="primary" />}>新增</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton render={<Button variant="secondary" />}>匯出</ToolbarButton>
        <ToolbarButton render={<Button variant="danger" />} disabled onClick={fn()}>
          刪除
        </ToolbarButton>
      </>
    ),
  },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
  },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
};

export const WithIcons: Story = {
  args: {
    children: (
      <>
        <ToolbarButton render={<Button variant="ghost" />}>
          <Icon name="plus" size={16} />
          新增
        </ToolbarButton>
        <ToolbarButton render={<Button variant="ghost" />}>
          <Icon name="edit" size={16} />
          編輯
        </ToolbarButton>
        <ToolbarButton render={<Button variant="ghost" />}>
          <Icon name="trash" size={16} />
          刪除
        </ToolbarButton>
      </>
    ),
  },
};

export const Groups: Story = {
  args: {
    children: (
      <>
        <ToolbarGroup>
          <ToolbarButton render={<Button variant="ghost" />}>複製</ToolbarButton>
          <ToolbarButton render={<Button variant="ghost" />}>貼上</ToolbarButton>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToolbarButton render={<Button variant="ghost" />}>上移</ToolbarButton>
          <ToolbarButton render={<Button variant="ghost" />}>下移</ToolbarButton>
        </ToolbarGroup>
      </>
    ),
  },
};
