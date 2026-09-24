import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input, Textarea } from '../Input';
import { Field } from './Field';

const meta = {
  title: 'Components/Field',
  component: Field,
  args: {
    label: '專案名稱',
    children: <Input placeholder="請輸入專案名稱" />,
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Required: Story = {
  args: { required: true },
};

export const WithDescription: Story = {
  args: { description: '最多 64 個字元。' },
};

export const WithError: Story = {
  args: {
    description: '最多 64 個字元。',
    error: '專案名稱重複',
  },
};

export const WithTextarea: Story = {
  args: {
    label: '專案描述',
    description: '簡單說明這個專案的用途。',
    children: <Textarea placeholder="請輸入描述" />,
  },
};
