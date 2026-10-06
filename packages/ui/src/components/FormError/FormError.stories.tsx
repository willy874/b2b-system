import type { Meta, StoryObj } from '@storybook/react-vite';

import { FormError } from './FormError';

const meta = {
  title: 'Components/FormError',
  component: FormError,
  args: {
    children: '帳號或密碼錯誤，請再試一次。',
    code: 'AUTH_INVALID_CREDENTIALS',
  },
} satisfies Meta<typeof FormError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** 沒有訊息時不佔版面，但元素仍在（報讀器才確定會念出之後放進來的訊息）。 */
export const Empty: Story = {
  args: { children: undefined, code: undefined },
};
