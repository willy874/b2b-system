import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { FileUpload } from './FileUpload';

const meta = {
  title: 'Components/FileUpload',
  component: FileUpload,
  args: {
    files: [],
    onFilesChange: fn(),
  },
} satisfies Meta<typeof FileUpload>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Multiple: Story = {
  args: { multiple: true },
};

export const WithAcceptAndMaxSize: Story = {
  args: {
    accept: 'image/png,image/jpeg',
    maxSize: 1024 * 1024,
    onRejected: fn(),
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

const sampleFile = new File(['內容'], 'avatar.png', { type: 'image/png' });

export const WithSelectedFiles: Story = {
  args: {
    files: [sampleFile],
  },
};

/** 受控使用：檔案清單由外部 state 管理，選擇與移除都會更新它。 */
function ControlledDemo() {
  const [files, setFiles] = useState<File[]>([]);
  return <FileUpload files={files} onFilesChange={setFiles} multiple />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
