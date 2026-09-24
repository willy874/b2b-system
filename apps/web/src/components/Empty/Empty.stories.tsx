import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button';
import { Icon } from '../Icon';
import { Empty } from './Empty';

const meta = {
  title: 'Components/Empty',
  component: Empty,
  args: {
    title: '目前沒有任何專案',
  },
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDescription: Story = {
  args: {
    description: '建立第一個專案，之後就能開始編輯內容。',
  },
};

export const WithAction: Story = {
  args: {
    description: '建立第一個專案，之後就能開始編輯內容。',
    action: (
      <Button variant="primary" startIcon={<Icon name="plus" size={16} />}>
        新增專案
      </Button>
    ),
  },
};
