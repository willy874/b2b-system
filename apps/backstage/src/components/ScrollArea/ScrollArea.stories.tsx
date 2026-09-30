import type { Meta, StoryObj } from '@storybook/react-vite';

import { ScrollArea } from './ScrollArea';

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  args: {
    children: (
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 30 }, (_, index) => (
          <li key={index}>第 {index + 1} 列內容</li>
        ))}
      </ul>
    ),
  },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['vertical', 'horizontal', 'both'] },
  },
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { maxHeight: 240 },
  render: (args) => (
    <div style={{ width: '20rem' }}>
      <ScrollArea {...args} />
    </div>
  ),
};

export const Horizontal: Story = {
  args: {
    orientation: 'horizontal',
    maxHeight: 120,
    children: (
      <div className="flex gap-2">
        {Array.from({ length: 20 }, (_, index) => (
          <span
            key={index}
            className="flex items-center justify-center"
            style={{ width: '5rem', height: '5rem', flexShrink: 0 }}
          >
            項目 {index + 1}
          </span>
        ))}
      </div>
    ),
  },
  render: (args) => (
    <div style={{ width: '20rem' }}>
      <ScrollArea {...args} />
    </div>
  ),
};

export const Both: Story = {
  args: {
    orientation: 'both',
    maxHeight: 200,
    children: (
      <div style={{ width: '40rem' }}>
        {Array.from({ length: 20 }, (_, index) => (
          <p key={index}>
            這是一段很長的內容，用來測試同時出現水平與垂直捲軸的情況。第 {index + 1} 行。
          </p>
        ))}
      </div>
    ),
  },
  render: (args) => (
    <div style={{ width: '20rem' }}>
      <ScrollArea {...args} />
    </div>
  ),
};
