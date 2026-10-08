import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { SAMPLE_RICH_TEXT_DOCUMENT } from '../RichTextViewer/sampleDocument';
import { LazyRichTextEditor } from './LazyRichTextEditor';

const meta = {
  title: 'Components/LazyRichTextEditor',
  component: LazyRichTextEditor,
  args: {
    defaultValue: SAMPLE_RICH_TEXT_DOCUMENT,
    onChange: fn(),
    placeholder: '輸入內容…',
    'aria-label': '內容',
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof LazyRichTextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 與 `RichTextEditor` 相同的 props；第一次渲染時才下載編輯器（Storybook 裡通常已經快取，
 * 要看骨架可以在 DevTools 把網路調慢後重新整理）。
 */
export const Playground: Story = {};

export const WithMaxLength: Story = {
  args: { defaultValue: undefined, maxLength: 500 },
};
