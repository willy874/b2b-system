import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import fileZhTW from '../../../locales/zh_TW.json';
import type { BrowserItemVM } from '../adapter';
import { FileDeleteDialog } from '../components/FileDeleteDialog';

const file = { type: 'file', name: 'a.png' } as BrowserItemVM;
const folder = { type: 'folder', name: '美術' } as BrowserItemVM;

function renderDialog(items: BrowserItemVM[]) {
  renderWithPermissions(
    <FileDeleteDialog
      items={items}
      loading={false}
      onCancel={() => undefined}
      onConfirm={() => Promise.resolve()}
    />,
  );
  return screen.getByTestId('file-delete-dialog');
}

beforeAll(() => initTestI18n(fileZhTW));
afterEach(resetFeatureStore);

describe('FileDeleteDialog 的說明跟著回收桶（docs/architecture/05-tenancy.md §5.1）', () => {
  const cases = [
    ['單一檔案', [file]],
    ['單一資料夾', [folder]],
    ['多個檔案', [file, { ...file, name: 'b.png' }]],
    ['含資料夾的多個項目', [file, folder]],
  ] as const;

  it.each(cases)('回收桶已啟用：%s → 說明會移到回收桶', (_, items) => {
    featureStore.setState({ resolved: true, statuses: new Map([['trash', 'ready']]) });
    expect(renderDialog([...items])).toHaveTextContent('回收桶');
  });

  it.each(cases)('回收桶未啟用：%s → 不提回收桶與還原', (_, items) => {
    featureStore.setState({ resolved: true, statuses: new Map([['trash', 'disabled']]) });
    const dialog = renderDialog([...items]);
    expect(dialog).toHaveTextContent('確定要刪除');
    expect(dialog).not.toHaveTextContent(/回收桶|還原/);
  });
});
