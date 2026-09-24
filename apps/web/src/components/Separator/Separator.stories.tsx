import type { Meta, StoryObj } from '@storybook/react-vite';

import { Separator } from './Separator';

const meta = {
  title: 'Components/Separator',
  component: Separator,
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div style={{ width: '16rem' }}>
      <p>上半部內容</p>
      <Separator {...args} />
      <p>下半部內容</p>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <div className="flex items-center gap-2" style={{ height: '2rem' }}>
      <span>左側</span>
      <Separator {...args} />
      <span>右側</span>
    </div>
  ),
};
