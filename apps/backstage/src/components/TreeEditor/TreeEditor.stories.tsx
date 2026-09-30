import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Chip } from '../Chip';
import { Input } from '../Input';
import { TreeEditor } from './TreeEditor';
import { updateNodeData } from './treeGraph';
import type { TreeEditorNode, TreeEditorValue } from './treeGraph';

interface Topic {
  label: string;
}

const outline: TreeEditorValue<Topic> = {
  nodes: [
    { id: 'root', data: { label: '總覽' } },
    { id: 'a', data: { label: '第一章' } },
    { id: 'a1', data: { label: '1.1 背景' } },
    { id: 'a2', data: { label: '1.2 目標' } },
    { id: 'b', data: { label: '第二章' } },
    { id: 'b1', data: { label: '2.1 做法' } },
  ],
  edges: [
    { source: 'root', target: 'a' },
    { source: 'a', target: 'a1' },
    { source: 'a', target: 'a2' },
    { source: 'root', target: 'b' },
    { source: 'b', target: 'b1' },
  ],
};

let sequence = 0;
const createTopic = (): TreeEditorNode<Topic> => {
  sequence += 1;
  return { id: `topic-${sequence}`, data: { label: `新節點 ${sequence}` } };
};

const meta = {
  title: 'Components/TreeEditor',
  component: TreeEditor<Topic>,
  args: {
    defaultValue: outline,
    getNodeLabel: (node) => node.data.label,
    createNode: createTopic,
    onChange: fn(),
    onSelectionChange: fn(),
    'aria-label': '樹狀圖',
  },
  argTypes: {
    mode: { control: 'inline-radio', options: ['tree', 'dag'] },
    direction: { control: 'inline-radio', options: ['TB', 'BT', 'LR', 'RL'] },
    layout: { control: 'inline-radio', options: ['manual', 'auto'] },
    edgeType: { control: 'inline-radio', options: ['smoothstep', 'bezier', 'straight'] },
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TreeEditor<Topic>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 拖把手連線（`tree` 模式連到已有父節點的節點＝換父節點）、Tab 新增子節點、Delete 刪除、⌘Z 復原。 */
export const Playground: Story = {};

/** 只在乎結構：每次改動都重新排版，節點不能拖。 */
export const AutoLayout: Story = {
  args: { layout: 'auto', direction: 'LR' },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
};

export const Empty: Story = {
  args: { defaultValue: { nodes: [], edges: [] } },
};

// ── 技能樹：多個前置（dag）、下→上、自訂節點內容、旁邊的屬性面板 ──

interface Skill {
  name: string;
  cost: number;
}

const skills: TreeEditorValue<Skill> = {
  nodes: [
    { id: 'basic', data: { name: '基礎訓練', cost: 1 }, position: { x: 200, y: 400 } },
    { id: 'power', data: { name: '力量', cost: 2 }, position: { x: 40, y: 272 } },
    { id: 'agility', data: { name: '敏捷', cost: 2 }, position: { x: 360, y: 272 } },
    { id: 'heavy', data: { name: '重擊', cost: 3 }, position: { x: 40, y: 144 } },
    { id: 'dodge', data: { name: '閃避', cost: 3 }, position: { x: 360, y: 144 } },
    { id: 'master', data: { name: '大師', cost: 5 }, position: { x: 200, y: 16 } },
  ],
  edges: [
    { source: 'basic', target: 'power' },
    { source: 'basic', target: 'agility' },
    { source: 'power', target: 'heavy' },
    { source: 'agility', target: 'dodge' },
    { source: 'heavy', target: 'master' },
    { source: 'dodge', target: 'master' },
  ],
};

function SkillTreeDemo() {
  const [value, setValue] = useState(skills);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = value.nodes.find((node) => node.id === selectedId);

  return (
    <div className="grid grid-cols-[1fr_16rem] gap-4">
      <TreeEditor<Skill>
        value={value}
        onChange={setValue}
        mode="dag"
        direction="BT"
        nodeSize={{ width: 160, height: 56 }}
        getNodeLabel={(node) => node.data.name}
        renderNode={(node) => (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{node.data.name}</span>
            <Chip tone="brand">{node.data.cost} 點</Chip>
          </span>
        )}
        createNode={() => {
          sequence += 1;
          return { id: `skill-${sequence}`, data: { name: `新技能 ${sequence}`, cost: 1 } };
        }}
        onSelectionChange={(ids) => setSelectedId(ids.length === 1 ? ids[0] : undefined)}
        aria-label="技能樹"
      />
      <div className="grid content-start gap-2">
        {selected ? (
          <>
            <Input
              aria-label="名稱"
              value={selected.data.name}
              onChange={(event) => {
                const name = event.target.value;
                setValue((prev) =>
                  updateNodeData(prev, selected.id, (data) => ({ ...data, name })),
                );
              }}
            />
            <Input
              aria-label="花費"
              type="number"
              value={String(selected.data.cost)}
              onChange={(event) => {
                const cost = Number(event.target.value);
                setValue((prev) =>
                  updateNodeData(prev, selected.id, (data) => ({ ...data, cost })),
                );
              }}
            />
          </>
        ) : (
          <p className="text-sm text-muted">選一個節點來編輯</p>
        )}
      </div>
    </div>
  );
}

/** `dag`：「大師」需要「重擊」與「閃避」兩個前置；選取節點後在右側編輯資料。 */
export const SkillTree: Story = {
  render: () => <SkillTreeDemo />,
};
