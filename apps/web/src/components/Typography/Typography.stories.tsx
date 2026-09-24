import type { Meta, StoryObj } from '@storybook/react-vite';

import { Paragraph } from './Paragraph';
import { Text } from './Text';
import { Title } from './Title';
import { Typography } from './Typography';

const meta = {
  title: 'Components/Typography',
  component: Typography,
  args: {
    children: '商品清單',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['pageTitle', 'sectionTitle', 'subtitle', 'body', 'bodyStrong', 'caption', 'code'],
    },
    tone: {
      control: 'inline-radio',
      options: ['default', 'muted', 'brand', 'danger', 'success'],
    },
    strong: { control: 'boolean' },
  },
} satisfies Meta<typeof Typography>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Typography variant="pageTitle">頁面標題</Typography>
      <Typography variant="sectionTitle">區塊標題</Typography>
      <Typography variant="subtitle">副標題</Typography>
      <Typography variant="body">本文內容，用來說明商品的細節與備註。</Typography>
      <Typography variant="bodyStrong">加粗本文，用來強調重要資訊。</Typography>
      <Typography variant="caption">輔助說明文字</Typography>
      <Typography variant="code">const price = 100;</Typography>
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Typography tone="default">預設色調</Typography>
      <Typography tone="muted">淡化色調</Typography>
      <Typography tone="brand">品牌色調</Typography>
      <Typography tone="danger">危險色調</Typography>
      <Typography tone="success">成功色調</Typography>
    </div>
  ),
};

/** 視覺與語意分離：外觀維持 `pageTitle`，但實際標籤換成 `h2`。 */
export const CustomTag: Story = {
  args: { variant: 'pageTitle', as: 'h2', children: '以 h2 呈現的頁面標題' },
};

/** 語意元件：`Title` 以 `level` 決定外觀與標籤，`Text` 是行內、`Paragraph` 是段落。 */
export const SemanticComponents: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Title level={1}>一級標題（h1）</Title>
      <Title level={2}>二級標題（h2）</Title>
      <Title level={3}>三級標題（h3）</Title>
      <Paragraph>
        段落中可以放 <Text strong>加粗文字</Text>、<Text tone="brand">品牌色文字</Text>、
        <Text code>code</Text> 與 <Text size="sm">小字說明</Text>。
      </Paragraph>
      <Paragraph size="sm">小字段落，用於表單或區塊底下的補充說明。</Paragraph>
    </div>
  ),
};
