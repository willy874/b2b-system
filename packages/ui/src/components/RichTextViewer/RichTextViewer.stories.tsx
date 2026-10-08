import type { Meta, StoryObj } from '@storybook/react-vite';

import { RichTextViewer } from './RichTextViewer';
import { SAMPLE_RICH_TEXT_DOCUMENT } from './sampleDocument';

const meta = {
  title: 'Components/RichTextViewer',
  component: RichTextViewer,
  args: { value: SAMPLE_RICH_TEXT_DOCUMENT },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RichTextViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 唯讀顯示：不載入編輯器，排版與 RichTextEditor 的編輯區相同。 */
export const Playground: Story = {};

/** 不安全的連結（`javascript:`）只顯示文字；認不得的節點保留裡面的文字。 */
export const UntrustedContent: Story = {
  args: {
    value: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '這個連結被改成 ' },
            {
              type: 'text',
              text: 'javascript:',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            { type: 'text', text: '，只顯示文字；HTML 字串 <b>不會</b> 被解析。' },
          ],
        },
        {
          type: 'futureBlock',
          content: [{ type: 'text', text: '之後新增的節點類型：保留文字。' }],
        },
      ],
    },
  },
};

export const Empty: Story = {
  args: { value: undefined },
};
