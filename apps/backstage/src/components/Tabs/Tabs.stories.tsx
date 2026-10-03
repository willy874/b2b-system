import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { fn } from 'storybook/test';

import { Tabs, TabsPanel } from './Tabs';
import type { TabDescriptor } from './Tabs';

const tabs: TabDescriptor[] = [
  { value: 'basic', label: '基本資料' },
  { value: 'inventory', label: '庫存' },
  { value: 'history', label: '異動紀錄' },
];

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  args: {
    value: 'basic',
    tabs,
    onValueChange: fn(),
    children: (
      <>
        <TabsPanel value="basic">商品的名稱、分類與描述。</TabsPanel>
        <TabsPanel value="inventory">目前庫存數量與安全庫存門檻。</TabsPanel>
        <TabsPanel value="history">最近的進貨與出貨紀錄。</TabsPanel>
      </>
    ),
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** 受控切換：`value` 交由呼叫端狀態決定，`onValueChange` 只負責回報。 */
function ControlledDemo() {
  const [value, setValue] = useState('basic');
  return (
    <Tabs value={value} tabs={tabs} onValueChange={setValue}>
      <TabsPanel value="basic">商品的名稱、分類與描述。</TabsPanel>
      <TabsPanel value="inventory">目前庫存數量與安全庫存門檻。</TabsPanel>
      <TabsPanel value="history">最近的進貨與出貨紀錄。</TabsPanel>
    </Tabs>
  );
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

export const WithoutPanels: Story = {
  args: { children: undefined },
};

const manyTabs: TabDescriptor[] = [
  { value: 'basic', label: '基本資料' },
  { value: 'inventory', label: '庫存' },
  { value: 'pricing', label: '價格與折扣' },
  { value: 'supplier', label: '供應商' },
  { value: 'shipping', label: '出貨設定' },
  { value: 'history', label: '異動紀錄' },
  { value: 'attachment', label: '附件' },
];

/** 可拖曳右下角調整寬度。 */
function Resizable({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div
      className="overflow-auto resize-x border border-dashed border-border p-2"
      style={{ width, minWidth: 120, maxWidth: '100%' }}
    >
      {children}
    </div>
  );
}

function OverflowDemo() {
  const [value, setValue] = useState('basic');
  return (
    <Resizable width={420}>
      <Tabs value={value} tabs={manyTabs} onValueChange={setValue}>
        <p className="m-0 text-sm">目前分頁：{value}</p>
      </Tabs>
    </Resizable>
  );
}

/**
 * 放不下的分頁從尾端收進「更多」下拉；從下拉選了分頁之後，它會佔最後一個可見位置。
 * 拖曳容器右下角可以看到分頁跟著寬度收合與展開。
 */
export const Overflow: Story = {
  render: () => <OverflowDemo />,
};
