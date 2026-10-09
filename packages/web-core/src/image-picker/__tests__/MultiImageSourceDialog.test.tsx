import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '../../permission';
import { usePermissionStore } from '../../store';
import { initTestI18n } from '../../testing/i18n';
import { AllProviders, renderWithPermissions } from '../../testing/renderWithPermissions';
import { MultiImageSourceDialog } from '../MultiImageSourceDialog';
import { registerImageSource, resetImagePickerRegistry } from '../registry';
import type { ImageSourceDefinition, ImageSourceProps, ImageUsage } from '../types';
import { useMultiImageSourcesAvailable } from '../useMultiImageSources';

const GALLERY_ITEM: ImageUsage = {
  id: 'gallery.item',
  maxSize: 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png'],
  minWidth: 1,
  minHeight: 1,
  aspectRatio: null,
  presets: {},
  sources: null,
};

/** 假的來源：三張圖，依 `multiple` 顯示勾選狀態。 */
function fakeSource(prefix: string) {
  return function FakeSource({ multiple, onSelect }: ImageSourceProps) {
    return (
      <div data-testid="fake-source" data-value={prefix}>
        {['1', '2', '3'].map((index) => {
          const refId = `${prefix}-${index}`;
          return (
            <button
              key={refId}
              type="button"
              aria-pressed={multiple?.selected.has(refId)}
              onClick={() =>
                multiple
                  ? multiple.onToggle({ refId, name: `${refId}.jpg` })
                  : onSelect({ kind: 'source', source: prefix, refId, name: refId, preview: null })
              }
            >
              {refId}
            </button>
          );
        })}
      </div>
    );
  };
}

function register(overrides: Partial<ImageSourceDefinition> & { id: string }) {
  registerImageSource({
    order: 30,
    labelKey: 'imagePicker.title',
    supportsMultiple: true,
    component: fakeSource(overrides.id),
    ...overrides,
  });
}

function renderDialog(
  props: Partial<Parameters<typeof MultiImageSourceDialog>[0]> = {},
  permissions: PermissionKey[] = [],
) {
  const onConfirm = vi.fn<Parameters<typeof MultiImageSourceDialog>[0]['onConfirm']>();
  const onClose = vi.fn();
  renderWithPermissions(
    <MultiImageSourceDialog
      usage={GALLERY_ITEM}
      exclude={['gallery']}
      title="從其他來源加入"
      confirmLabel={(count) => `加入 ${count} 張`}
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
    permissions,
  );
  return { onConfirm, onClose };
}

function countBadge() {
  return screen.getByTestId('image-picker-multiple-count');
}

describe('MultiImageSourceDialog（docs/architecture/frontend/23-image-picker.md §2.1）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  beforeEach(() => {
    resetImagePickerRegistry();
  });

  it('只列出支援多選、有權限、用途允許、沒被排除的來源；「最近使用」一律不列', async () => {
    register({ id: 'file', order: 30, labelKey: 'imagePicker.title' });
    register({ id: 'gallery', order: 40 });
    register({ id: 'recent', order: 20 });
    register({ id: 'single', order: 50, supportsMultiple: false });
    register({
      id: 'locked',
      order: 60,
      isAvailable: ({ can }) => can('locked:read' as PermissionKey),
    });
    register({ id: 'other', order: 70, labelKey: 'imagePicker.recrop' });
    renderDialog({ usage: { ...GALLERY_ITEM, sources: ['file', 'gallery', 'recent', 'other'] } });

    const dialog = await screen.findByTestId('image-picker-multiple-dialog');
    await within(dialog).findByTestId('fake-source');
    const tabs = within(dialog)
      .getAllByRole('tab')
      .map((tab) => tab.textContent);
    expect(tabs).toEqual(['選擇圖片', '裁切']);
  });

  it('沒有任何可用的來源時顯示空狀態，確認鈕停用', async () => {
    register({ id: 'gallery' });
    renderDialog();
    expect(await screen.findByText('沒有其他可以加入的來源')).toBeInTheDocument();
    expect(screen.getByTestId('image-picker-multiple-confirm')).toBeDisabled();
  });

  it('勾選與取消勾選更新已選數量；0 張時確認鈕停用', async () => {
    register({ id: 'file' });
    renderDialog();
    const confirm = screen.getByTestId('image-picker-multiple-confirm');
    expect(confirm).toBeDisabled();

    await userEvent.click(await screen.findByRole('button', { name: 'file-1' }));
    await userEvent.click(screen.getByRole('button', { name: 'file-2' }));
    expect(countBadge()).toHaveAttribute('data-value', '2');
    expect(screen.getByRole('button', { name: 'file-1' })).toHaveAttribute('aria-pressed', 'true');
    expect(confirm).toHaveTextContent('加入 2 張');
    expect(confirm).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'file-1' }));
    expect(countBadge()).toHaveAttribute('data-value', '1');
    expect(screen.getByRole('button', { name: 'file-1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('切換分頁時清空勾選（後端一次只收一個來源）', async () => {
    register({ id: 'file', order: 30, labelKey: 'imagePicker.title' });
    register({ id: 'other', order: 40, labelKey: 'imagePicker.recrop' });
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'file-1' }));
    expect(countBadge()).toHaveAttribute('data-value', '1');

    await userEvent.click(screen.getByRole('tab', { name: '裁切' }));
    expect(await screen.findByRole('button', { name: 'other-1' })).toBeInTheDocument();
    expect(countBadge()).toHaveAttribute('data-value', '0');
    expect(screen.getByTestId('image-picker-multiple-confirm')).toBeDisabled();
  });

  it('超過上限時不再加入並提示；取消勾選仍然可以', async () => {
    register({ id: 'file' });
    renderDialog({ max: 2 });
    await userEvent.click(await screen.findByRole('button', { name: 'file-1' }));
    await userEvent.click(screen.getByRole('button', { name: 'file-2' }));
    await userEvent.click(screen.getByRole('button', { name: 'file-3' }));

    expect(await screen.findByText('一次最多選 2 張')).toBeInTheDocument();
    expect(countBadge()).toHaveAttribute('data-value', '2');
    expect(screen.getByRole('button', { name: 'file-3' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'file-1' }));
    expect(countBadge()).toHaveAttribute('data-value', '1');
  });

  it('確認時以勾選的順序帶出來源 id 與每一張的 refId、名稱', async () => {
    register({ id: 'file' });
    const { onConfirm } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'file-3' }));
    await userEvent.click(screen.getByRole('button', { name: 'file-1' }));
    await userEvent.click(screen.getByTestId('image-picker-multiple-confirm'));

    expect(onConfirm).toHaveBeenCalledWith({
      source: 'file',
      items: [
        { refId: 'file-3', name: 'file-3.jpg' },
        { refId: 'file-1', name: 'file-1.jpg' },
      ],
    });
  });

  it('送出失敗時顯示錯誤訊息並保留勾選', async () => {
    register({ id: 'file' });
    const { onConfirm } = renderDialog();
    onConfirm.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(await screen.findByRole('button', { name: 'file-1' }));
    await userEvent.click(screen.getByTestId('image-picker-multiple-confirm'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('image-picker-multiple-confirm')).toBeEnabled());
    expect(countBadge()).toHaveAttribute('data-value', '1');
  });
});

function renderAvailable(usage: ImageUsage | undefined, exclude?: readonly string[]) {
  return renderHook(() => useMultiImageSourcesAvailable(usage, exclude), {
    wrapper: AllProviders,
  });
}

describe('useMultiImageSourcesAvailable', () => {
  beforeEach(() => {
    resetImagePickerRegistry();
    usePermissionStore.setState({ permissions: new Set(), hydrated: true });
  });

  it('有支援多選、可用的來源時為 true', async () => {
    register({ id: 'file' });
    const { result } = renderAvailable(GALLERY_ITEM, ['gallery']);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('只有被排除、不支援多選或不可用的來源時為 false', async () => {
    register({ id: 'gallery' });
    register({ id: 'single', supportsMultiple: false });
    register({ id: 'slow', isAvailable: async () => false });
    const { result } = renderAvailable(GALLERY_ITEM, ['gallery']);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('還不知道用途時是 undefined', () => {
    register({ id: 'file' });
    const { result } = renderAvailable(undefined);
    expect(result.current).toBeUndefined();
  });
});
