import type { Meta, StoryObj } from '@storybook/react-vite';
import { Link as RouterLink } from '@tanstack/react-router';
import { fn } from 'storybook/test';

import { Link } from './Link';

const meta = {
  title: 'Components/Link',
  component: Link,
  args: {
    href: '#',
    children: '專案列表',
    onClick: fn(),
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['brand', 'muted', 'danger'] },
    underline: { control: 'inline-radio', options: ['hover', 'always', 'none'] },
  },
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="flex gap-4">
      <Link {...args} tone="brand">
        品牌色
      </Link>
      <Link {...args} tone="muted">
        次要色
      </Link>
      <Link {...args} tone="danger">
        危險色
      </Link>
    </div>
  ),
};

export const Underline: Story = {
  render: (args) => (
    <div className="flex gap-4">
      <Link {...args} underline="hover">
        hover 時加底線
      </Link>
      <Link {...args} underline="always">
        永遠有底線
      </Link>
      <Link {...args} underline="none">
        沒有底線
      </Link>
    </div>
  ),
};

/** 以 `render` 換成 TanStack Router 的 Link，樣式仍然套用。 */
export const AsRouterLink: Story = {
  parameters: { router: true },
  args: {
    render: <RouterLink to="/" />,
    children: '前往首頁',
  },
};
