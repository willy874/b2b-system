import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button';
import { Icon } from '../Icon';
import { PageHeader } from './PageHeader';

const meta = {
  title: 'Components/PageHeader',
  component: PageHeader,
  args: {
    title: '使用者',
    description: '管理帳號、狀態與角色指派。',
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button startIcon={<Icon name="download" size={16} />}>匯出</Button>
        <Button startIcon={<Icon name="upload" size={16} />}>匯入</Button>
        <Button variant="primary">建立使用者</Button>
      </>
    ),
  },
};

/** 窄螢幕：操作換到標題下方，不擠壓標題。 */
export const Narrow: Story = {
  ...WithActions,
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
