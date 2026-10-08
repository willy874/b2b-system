import { isRichTextEmpty } from '@b2b-system/rich-text';
import type { RichTextDocument } from '@b2b-system/rich-text';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Field } from '../Field';
import { JsonViewer } from '../JsonViewer';
import { RichTextViewer } from '../RichTextViewer/RichTextViewer';
import { SAMPLE_RICH_TEXT_DOCUMENT } from '../RichTextViewer/sampleDocument';
import { RichTextEditor } from './RichTextEditor';

const meta = {
  title: 'Components/RichTextEditor',
  component: RichTextEditor,
  args: {
    defaultValue: SAMPLE_RICH_TEXT_DOCUMENT,
    onChange: fn(),
    onBlur: fn(),
    placeholder: '輸入內容…',
    'aria-label': '內容',
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RichTextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Tiptap（ProseMirror）：工具列或快捷鍵套用格式（⌘/Ctrl + B、I、U；⌘/Ctrl + K 連結；⌘/Ctrl + Z 復原），
 * 也支援 Markdown 式的輸入（`## ` 標題、`- ` 清單、`> ` 引言、```` ``` ```` 程式碼區塊）。
 */
export const Playground: Story = {};

export const Empty: Story = {
  args: { defaultValue: undefined },
};

/** 受控：右側以 RichTextViewer 顯示同一份值，下方是存進資料庫的 JSON。 */
export const Controlled: Story = {
  render: (args) => <ControlledDemo {...args} />,
};

function ControlledDemo(args: Story['args']) {
  const [value, setValue] = useState<RichTextDocument>(SAMPLE_RICH_TEXT_DOCUMENT);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <RichTextEditor {...args} defaultValue={undefined} value={value} onChange={setValue} />
        <RichTextViewer value={value} aria-label="預覽" />
      </div>
      <JsonViewer value={value} aria-label="文件 JSON" defaultExpandDepth={2} />
    </div>
  );
}

/** 只開放部分格式：沒有的格式連貼上也會被拿掉（試著貼上帶標題、清單的內容）。 */
export const LimitedFormats: Story = {
  args: {
    formats: ['bold', 'italic', 'link'],
    defaultValue: undefined,
    placeholder: '留言（可加粗、斜體與連結）',
    minHeight: '3rem',
  },
};

/** 字數上限：到上限後不能再輸入，下方顯示字數。 */
export const MaxLength: Story = {
  args: { maxLength: 200, defaultValue: undefined },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** 放在 Field 裡：以標籤命名，錯誤以 aria-describedby 連到編輯區。 */
export const InField: Story = {
  render: (args) => <FieldDemo {...args} />,
};

function FieldDemo(args: Story['args']) {
  const [value, setValue] = useState<RichTextDocument>();
  return (
    <Field
      label="說明"
      required
      description="會顯示在詳情頁"
      error={value && isRichTextEmpty(value) ? '請填寫說明' : undefined}
    >
      <RichTextEditor
        {...args}
        aria-label={undefined}
        defaultValue={undefined}
        value={value}
        onChange={setValue}
      />
    </Field>
  );
}

/** 窄的容器：放不下的按鈕從尾端收進「更多」，按下的格式在下拉裡以勾號表示。 */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 320 }}>{Story()}</div>],
};
