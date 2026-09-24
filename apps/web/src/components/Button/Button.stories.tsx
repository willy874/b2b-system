import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Icon } from '../Icon';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { ButtonLink } from './Link';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: {
    children: '儲存',
    onClick: fn(),
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex gap-2">
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="danger">
        Danger
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  args: {
    variant: 'primary',
    startIcon: <Icon name="plus" size={16} />,
    children: '新增',
  },
};

export const Loading: Story = {
  args: { variant: 'primary', loading: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Block: Story = {
  args: { block: true, variant: 'primary' },
  parameters: { layout: 'padded' },
};

export const IconOnly: Story = {
  render: (args) => (
    <div className="flex gap-2">
      <IconButton {...args} aria-label="編輯">
        <Icon name="edit" size={16} />
      </IconButton>
      <IconButton {...args} aria-label="刪除" variant="danger">
        <Icon name="trash" size={16} />
      </IconButton>
    </div>
  ),
};

/** 會換頁的按鈕：真正的 `<a href>`，需要 router context。 */
export const AsLink: Story = {
  parameters: { router: true },
  render: () => (
    <div className="flex gap-2">
      <ButtonLink to="/" variant="primary">
        前往首頁
      </ButtonLink>
      <ButtonLink to="/" disabled>
        停用的連結
      </ButtonLink>
    </div>
  ),
};
