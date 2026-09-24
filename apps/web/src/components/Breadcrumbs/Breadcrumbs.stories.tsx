import type { Meta, StoryObj } from '@storybook/react-vite';

import { Breadcrumbs } from './Breadcrumbs';

const items = [
  { key: 'home', label: '首頁', href: '/' },
  { key: 'category', label: '分類', href: '/category' },
  { key: 'detail', label: '目前頁面' },
];

const meta = {
  title: 'Components/Breadcrumbs',
  component: Breadcrumbs,
  args: { items },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const TwoLevels: Story = {
  args: {
    items: [
      { key: 'home', label: '首頁', href: '/' },
      { key: 'detail', label: '目前頁面' },
    ],
  },
};

export const SingleLevel: Story = {
  args: { items: [{ key: 'home', label: '首頁' }] },
};
