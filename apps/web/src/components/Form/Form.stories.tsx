import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Field } from '../Field';
import { Input } from '../Input';
import { Form } from './Form';

const meta = {
  title: 'Components/Form',
  component: Form,
  args: {
    onSubmit: fn((event: React.FormEvent) => event.preventDefault()),
    children: (
      <>
        <Field name="name" label="專案名稱">
          <Input name="name" placeholder="請輸入專案名稱" />
        </Field>
        <Button type="submit" variant="primary">
          送出
        </Button>
      </>
    ),
  },
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="w-80">
      <Form {...args} />
    </div>
  ),
};

/** 後端回傳的欄位錯誤，鍵要對上 `Field` 的 `name`。 */
export const WithServerErrors: Story = {
  args: {
    errors: { name: '專案名稱重複' },
  },
  render: (args) => (
    <div className="w-80">
      <Form {...args} />
    </div>
  ),
};
