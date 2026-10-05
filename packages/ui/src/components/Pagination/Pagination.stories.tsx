import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Pagination } from './Pagination';

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  args: { offset: 0, limit: 10, total: 123, onChange: fn() },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const MiddlePage: Story = {
  args: { offset: 40, limit: 10, total: 123 },
};

export const LastPage: Story = {
  args: { offset: 120, limit: 10, total: 123 },
};

export const Empty: Story = {
  args: { offset: 0, limit: 10, total: 0 },
};

function ControlledDemo() {
  const [{ offset, limit }, setState] = useState({ offset: 0, limit: 10 });
  return <Pagination offset={offset} limit={limit} total={97} onChange={setState} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
