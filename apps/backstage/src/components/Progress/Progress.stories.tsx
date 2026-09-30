import type { Meta, StoryObj } from '@storybook/react-vite';

import { Progress } from './Progress';

const meta = {
  title: 'Components/Progress',
  component: Progress,
  // 元件寬度是 100%，在置中版面裡要給容器寬度才看得出樣子
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { value: 40 },
  argTypes: {
    tone: { control: 'inline-radio', options: ['brand', 'success', 'danger'] },
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithLabelAndValue: Story = {
  args: { label: '上傳中', showValue: true },
};

export const Indeterminate: Story = {
  args: { value: null, label: '處理中' },
};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4" style={{ width: '16rem' }}>
      <Progress {...args} tone="brand" label="Brand" showValue />
      <Progress {...args} tone="success" label="Success" showValue />
      <Progress {...args} tone="danger" label="Danger" showValue />
    </div>
  ),
};

export const Complete: Story = {
  args: { value: 100, label: '完成', showValue: true },
};
