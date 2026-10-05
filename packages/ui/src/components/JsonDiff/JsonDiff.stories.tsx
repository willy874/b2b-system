import type { Meta, StoryObj } from '@storybook/react-vite';

import { JsonDiff } from './JsonDiff';

const permissions = [
  'auditLog:read',
  'permission:read',
  'role:create',
  'role:delete',
  'role:read',
  'role:update',
  'user:create',
  'user:read',
  'user:update',
];

const meta = {
  title: 'Components/JsonDiff',
  component: JsonDiff,
  args: {
    before: { name: '編輯者', isSystem: false, limits: { maxProjects: 10, ratio: 0.75 } },
    after: { name: '內容編輯', isSystem: false, limits: { maxProjects: 20, ratio: 0.75 } },
    'aria-label': '變更前後',
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof JsonDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** 長清單只改一項：變更前後各留 3 行，其餘收成摺疊列，點一下展開。 */
export const Folded: Story = {
  args: {
    before: { permissions },
    after: { permissions: permissions.filter((key) => key !== 'role:delete') },
  },
};

/** 建立：沒有變更前，整份都是新增。 */
export const Created: Story = {
  args: { before: undefined, after: { name: '稽核員', permissions: ['auditLog:read'] } },
};

/** 刪除：沒有變更後，整份都是刪除。 */
export const Deleted: Story = {
  args: { before: { name: '稽核員', slug: 'auditor' }, after: undefined },
};

export const NoChanges: Story = {
  args: { before: { a: 1 }, after: { a: 1 } },
};
