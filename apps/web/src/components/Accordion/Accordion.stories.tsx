import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import type { AccordionItemDescriptor } from './Accordion';
import { Accordion } from './Accordion';

const items: AccordionItemDescriptor[] = [
  { value: 'apple', title: '蘋果', content: '常見的溫帶水果，口感爽脆。' },
  { value: 'banana', title: '香蕉', content: '富含鉀離子，方便攜帶的水果。' },
  { value: 'cherry', title: '櫻桃', content: '體積小、味道偏甜，產季短暫。', disabled: true },
];

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  args: { items, onValueChange: fn() },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const SingleOpen: Story = {
  args: { single: true, defaultValue: ['apple'] },
};

export const MultipleOpen: Story = {
  args: { defaultValue: ['apple', 'banana'] },
};
