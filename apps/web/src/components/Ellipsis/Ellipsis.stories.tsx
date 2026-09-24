import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Chip } from '../Chip';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { TooltipProvider } from '../Tooltip';
import { BoxEllipsis } from './BoxEllipsis';
import { ButtonEllipsis } from './ButtonEllipsis';
import type { ButtonEllipsisItem } from './ButtonEllipsis';
import { TextEllipsis } from './TextEllipsis';

const LONG_TEXT =
  '這是一段很長的說明文字，容器不夠寬時會以省略號結尾，滑鼠移上去可以看到完整內容。';

const meta = {
  title: 'Components/Ellipsis',
  component: TextEllipsis,
  args: {
    children: LONG_TEXT,
    lines: 1,
    tooltip: 'auto',
    onCollapseChange: fn(),
  },
  argTypes: {
    tooltip: { control: 'inline-radio', options: ['auto', 'always', 'never'] },
    lines: { control: { type: 'number', min: 1, max: 5 } },
  },
  decorators: [
    (Story) => (
      <TooltipProvider delay={200}>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof TextEllipsis>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 拖曳右下角改變容器寬度。 */
function Resizable({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div
      className="overflow-auto resize-x border border-dashed border-border p-2"
      style={{ width, minWidth: 48, maxWidth: '100%' }}
    >
      {children}
    </div>
  );
}

export const Playground: Story = {
  render: (args) => (
    <Resizable width={240}>
      <TextEllipsis {...args} />
    </Resizable>
  ),
};

export const Multiline: Story = {
  args: { lines: 2 },
  render: (args) => (
    <Resizable width={240}>
      <TextEllipsis {...args} />
    </Resizable>
  ),
};

/** 夾在一段文字中間；寬度上限為父層寬度。 */
export const Inline: Story = {
  args: { inline: true, children: 'very-long-file-name-for-preview.png' },
  render: (args) => (
    <Resizable width={320}>
      檔案 <TextEllipsis {...args} /> 已上傳
    </Resizable>
  ),
};

/** 容器寬度低於 200px 時換成替代節點（這裡是圖示）；原文字留給螢幕報讀器與提示框。 */
export const CollapseAtBreakpoint: Story = {
  args: {
    children: '系統設定',
    collapseAt: 200,
    collapsedContent: <Icon name="settings" size={16} />,
  },
  render: (args) => (
    <Resizable width={260}>
      <TextEllipsis {...args} />
    </Resizable>
  ),
};

/** 完整內容放不下就收合成縮寫，容器變回夠寬時自動展開。 */
export const CollapseOnOverflow: Story = {
  args: {
    children: '2026 年第三季營運報告',
    collapseAt: 'overflow',
    collapsedContent: 'Q3 報告',
  },
  render: (args) => (
    <Resizable width={260}>
      <TextEllipsis {...args} />
    </Resizable>
  ),
};

const ACTIONS: ButtonEllipsisItem[] = [
  {
    key: 'create',
    label: '新增項目',
    icon: <Icon name="plus" size={16} />,
    variant: 'primary',
    onClick: fn(),
  },
  { key: 'edit', label: '編輯', icon: <Icon name="edit" size={16} />, onClick: fn() },
  { key: 'import', label: '匯入資料', icon: <Icon name="upload" size={16} />, onClick: fn() },
  { key: 'filter', label: '進階篩選條件', icon: <Icon name="filter" size={16} />, onClick: fn() },
  { key: 'settings', label: '設定', icon: <Icon name="settings" size={16} />, disabled: true },
  {
    key: 'delete',
    label: '刪除',
    icon: <Icon name="trash" size={16} />,
    variant: 'danger',
    onClick: fn(),
  },
];

function ButtonGroupDemo() {
  const [hidden, setHidden] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <Resizable width={640}>
        <ButtonEllipsis items={ACTIONS} onOverflowChange={setHidden} />
      </Resizable>
      <span className="text-xs text-muted">收進下拉：{hidden} 個</span>
    </div>
  );
}

/** 拖曳右下角縮放：放不下的按鈕從尾端收進「更多」下拉選單。 */
export const ButtonGroup: Story = {
  render: () => <ButtonGroupDemo />,
};

/** 容器寬度小於 520px 時先縮成只剩圖示（hover 顯示文字），仍放不下的才收進下拉。 */
export const ButtonGroupIconOnly: Story = {
  render: () => (
    <Resizable width={640}>
      <ButtonEllipsis items={ACTIONS} iconOnly={520} size="sm" />
    </Resizable>
  ),
};

/** `maxVisible` 可依寬度決定：窄於 360px 只留第一顆，其餘一律進下拉。 */
export const ButtonGroupMaxVisible: Story = {
  render: () => (
    <Resizable width={640}>
      <ButtonEllipsis
        items={ACTIONS}
        maxVisible={(width) => (width < 360 ? 1 : 3)}
        renderMoreTrigger={(hidden) => (
          <Button endIcon={<Icon name="chevron-down" size={16} />}>其他 {hidden.length} 項</Button>
        )}
        menuAlign="start"
      />
    </Resizable>
  ),
};

const TAGS = ['前端', '後端', '資料庫', '設計系統', '可近性', '效能', '測試', '文件'];

/** 放不下的項目收成 `+N`，hover 或鍵盤聚焦時列出被隱藏的項目。 */
export const Box: Story = {
  render: () => (
    <Resizable width={360}>
      <BoxEllipsis>
        {TAGS.map((tag) => (
          <Chip key={tag} tone="brand">
            {tag}
          </Chip>
        ))}
      </BoxEllipsis>
    </Resizable>
  ),
};

/** `renderOverflow` 自訂隱藏替代節點；`maxVisible` 限制最多顯示的數量。 */
export const BoxCustomOverflow: Story = {
  render: () => (
    <Resizable width={480}>
      <BoxEllipsis
        maxVisible={4}
        renderOverflow={({ hiddenCount, hiddenItems }) => (
          <Popover
            trigger={
              <Button size="sm" variant="ghost">
                還有 {hiddenCount} 個
              </Button>
            }
          >
            <div className="flex max-w-60 flex-wrap gap-1">{hiddenItems}</div>
          </Popover>
        )}
      >
        {TAGS.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </BoxEllipsis>
    </Resizable>
  ),
};
