import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
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
