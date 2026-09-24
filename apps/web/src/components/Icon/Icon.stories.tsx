import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icon } from './Icon';
import { ICONS } from './icons';

const meta = {
  title: 'Components/Icon',
  component: Icon,
  args: {
    name: 'settings',
  },
  argTypes: {
    size: { control: 'inline-radio', options: [14, 16, 20, 24] },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Icon {...args} size={14} />
      <Icon {...args} size={16} />
      <Icon {...args} size={20} />
      <Icon {...args} size={24} />
    </div>
  ),
};

export const WithLabel: Story = {
  args: { name: 'warning', 'aria-label': '警告' },
};

/** 顯示 `ICONS` 註冊表裡的每一個圖示與名稱。 */
export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-4">
      {Object.keys(ICONS).map((name) => (
        <div key={name} className="flex flex-col items-center gap-1">
          <Icon name={name as keyof typeof ICONS} size={20} />
          <span className="text-xs">{name}</span>
        </div>
      ))}
    </div>
  ),
};
