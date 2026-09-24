import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Menu } from './Menu';

const meta = {
  title: 'Components/Menu',
  component: Menu,
  args: {
    trigger: <Button>操作</Button>,
    items: [
      { key: 'edit', label: '編輯', onSelect: fn() },
      { key: 'delete', label: '刪除', tone: 'danger', onSelect: fn() },
    ],
  },
  argTypes: {
    align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
  },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDisabledItem: Story = {
  args: {
    items: [
      { key: 'edit', label: '編輯', onSelect: fn() },
      { key: 'archive', label: '封存', disabled: true, onSelect: fn() },
      { key: 'delete', label: '刪除', tone: 'danger', onSelect: fn() },
    ],
  },
};

export const Align: Story = {
  render: (args) => (
    <div className="flex gap-8">
      <Menu {...args} trigger={<Button>靠左</Button>} align="start" />
      <Menu {...args} trigger={<Button>置中</Button>} align="center" />
      <Menu {...args} trigger={<Button>靠右</Button>} align="end" />
    </div>
  ),
};
