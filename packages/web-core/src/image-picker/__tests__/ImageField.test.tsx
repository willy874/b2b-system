import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '../../permission';
import { initTestI18n } from '../../testing/i18n';
import { renderWithPermissions } from '../../testing/renderWithPermissions';
import { ImageField } from '../ImageField';
import { registerImagePickerApi, registerImageSource, resetImagePickerRegistry } from '../registry';
import type { ImagePickerApi, ImageSourceProps, ImageUsage, PickedImageAsset } from '../types';
import { pastedImageName } from '../useImagePicker';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const AVATAR: ImageUsage = {
  id: 'user.avatar',
  maxSize: 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png'],
  minWidth: 128,
  minHeight: 128,
  aspectRatio: 1,
  presets: { sm: 32, lg: 256 },
  sources: null,
};
const BANNER: ImageUsage = { ...AVATAR, id: 'tenant.banner', aspectRatio: null };

const ASSET: PickedImageAsset = {
  id: 'asset-1',
  status: 'pending',
  failureReason: null,
  image: null,
  original: null,
  crop: null,
};

function png(name = 'me.png', type = 'image/png'): File {
  return new File([Uint8Array.from([...PNG_HEAD, 0, 0, 0, 0])], name, { type });
}

function fakeApi(overrides: Partial<ImagePickerApi> = {}) {
  const api = {
    getUsages: vi.fn(async () => [AVATAR, BANNER]),
    upload: vi.fn(async () => ASSET),
    fromSource: vi.fn(async () => ({ ...ASSET, id: 'asset-2' })),
    getAsset: vi.fn(async (): Promise<PickedImageAsset> => ({
      ...ASSET,
      status: 'ready',
      original: { url: 'https://files.test/master.jpg', width: 400, height: 400 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    })),
    ...overrides,
  } satisfies ImagePickerApi;
  registerImagePickerApi(api);
  return api;
}

function GallerySource({ onSelect }: ImageSourceProps) {
  return (
    <button
      type="button"
      onClick={() =>
        onSelect({
          kind: 'source',
          source: 'gallery',
          refId: 'g1',
          name: 'team.jpg',
          preview: { src: 'https://files.test/team.jpg', width: 800, height: 600 },
        })
      }
    >
      pick-from-gallery
    </button>
  );
}

function renderField(
  props: Partial<Parameters<typeof ImageField>[0]> = {},
  permissions: PermissionKey[] = [],
) {
  const onChange = vi.fn();
  const onRecrop = vi.fn();
  renderWithPermissions(
    <ImageField
      usage="user.avatar"
      value={null}
      assetId={null}
      variant="lg"
      alt="Alice"
      onChange={onChange}
      onRecrop={onRecrop}
      {...props}
    />,
    permissions,
  );
  return { onChange, onRecrop };
}

async function changeButton() {
  const button = await screen.findByTestId('image-field-change');
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe('ImageField（docs/architecture/frontend/23-image-picker.md §1）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  beforeEach(() => {
    resetImagePickerRegistry();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview') }));
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('只剩上傳：按「更換」直接打開選檔視窗，不出現來源選擇', async () => {
    fakeApi();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    renderField();
    await userEvent.click(await changeButton());
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(screen.queryByTestId('image-picker-dialog')).not.toBeInTheDocument();
    click.mockRestore();
  });

  it('有其他可用的來源：開來源對話框，「上傳」固定在第一個；沒有權限的來源不列出', async () => {
    fakeApi();
    registerImageSource({
      id: 'gallery',
      order: 40,
      labelKey: 'imagePicker.title',
      isAvailable: ({ can }) => can('gallery:read' as PermissionKey),
      component: GallerySource,
    });
    registerImageSource({
      id: 'recent',
      order: 20,
      labelKey: 'imagePicker.recrop',
      isAvailable: async () => false,
      component: GallerySource,
    });
    renderField({}, ['gallery:read' as PermissionKey]);
    await userEvent.click(await changeButton());
    const dialog = await screen.findByTestId('image-picker-dialog');
    const tabs = within(dialog)
      .getAllByRole('tab')
      .map((tab) => tab.textContent);
    expect(tabs).toEqual(['上傳', '選擇圖片']);
  });

  it('選檔 → 用途要 1:1 先裁切 → 確定後上傳（帶裁切）→ onChange 帶新的資產 id，處理完之前先顯示選的圖', async () => {
    const api = fakeApi();
    const { onChange } = renderField();
    await changeButton();
    fireEvent.change(screen.getByTestId('image-field-input'), { target: { files: [png()] } });
    const dialog = await screen.findByTestId('image-picker-crop-dialog');
    await userEvent.click(within(dialog).getByTestId('image-picker-crop-confirm'));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ assetId: 'asset-1', asset: ASSET }),
    );
    expect(api.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: 'user.avatar',
        name: 'me.png',
        contentType: 'image/png',
        crop: { x: 0, y: 0, width: 1, height: 1 },
      }),
    );
    expect(screen.getByTestId('image-field-preview')).toHaveAttribute('data-state', 'processing');
  });

  it('沒有比例的用途：選好直接上傳，不出現裁切', async () => {
    const api = fakeApi();
    const { onChange } = renderField({ usage: 'tenant.banner' });
    await changeButton();
    fireEvent.change(screen.getByTestId('image-field-input'), { target: { files: [png()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({ crop: undefined }));
    expect(screen.queryByTestId('image-picker-crop-dialog')).not.toBeInTheDocument();
  });

  it('從其他來源挑：裁切後以 fromSource 複製', async () => {
    const api = fakeApi();
    registerImageSource({
      id: 'gallery',
      order: 40,
      labelKey: 'imagePicker.title',
      component: GallerySource,
    });
    const { onChange } = renderField();
    await userEvent.click(await changeButton());
    const dialog = await screen.findByTestId('image-picker-dialog');
    await userEvent.click(within(dialog).getByRole('tab', { name: '選擇圖片' }));
    await userEvent.click(await within(dialog).findByText('pick-from-gallery'));
    await userEvent.click(await screen.findByTestId('image-picker-crop-confirm'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-2' })),
    );
    expect(api.fromSource).toHaveBeenCalledWith({
      usage: 'user.avatar',
      source: 'gallery',
      refId: 'g1',
      // 800 × 600 取中央的正方形
      crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
    });
  });

  it('焦點在欄位上直接貼上：沒有檔名的圖以時間命名；貼上的不是圖片就不攔截', async () => {
    const api = fakeApi({ getUsages: vi.fn(async () => [BANNER]) });
    renderField({ usage: 'tenant.banner' });
    await changeButton();
    const field = screen.getByRole('button', { name: 'Alice的圖片' });
    fireEvent.paste(field, {
      clipboardData: { files: [new File(['x'], 'x.txt', { type: 'text/plain' })] },
    });
    expect(api.upload).not.toHaveBeenCalled();
    fireEvent.paste(field, { clipboardData: { files: [png('image.png')] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    expect(vi.mocked(api.upload).mock.lastCall?.[0].name).toMatch(
      /^貼上的圖片 \d{4}-\d{2}-\d{2} \d{2}:\d{2}\.png$/,
    );
  });

  it('不是用途收的型別（檔頭是 SVG）→ 提示原因，不上傳', async () => {
    const api = fakeApi();
    renderField();
    await changeButton();
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'fake.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByTestId('image-field-input'), { target: { files: [svg] } });
    expect(await screen.findByText(/不支援這種圖片格式/)).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('上傳失敗：錯誤顯示在裁切對話框，不關閉', async () => {
    fakeApi({ upload: vi.fn(async () => Promise.reject(new Error('boom'))) });
    const { onChange } = renderField();
    await changeButton();
    fireEvent.change(screen.getByTestId('image-field-input'), { target: { files: [png()] } });
    await userEvent.click(await screen.findByTestId('image-picker-crop-confirm'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('image-picker-crop-dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('移除：onChange(null)；重新裁切：以主檔開裁切，確定後 onRecrop', async () => {
    const api = fakeApi();
    const { onChange, onRecrop } = renderField({ assetId: 'asset-9' });
    await changeButton();
    await userEvent.click(screen.getByTestId('image-field-remove'));
    expect(onChange).toHaveBeenCalledWith({ assetId: null });

    await userEvent.click(screen.getByTestId('image-field-recrop'));
    await userEvent.click(await screen.findByTestId('image-picker-crop-confirm'));
    expect(api.getAsset).toHaveBeenCalledWith('asset-9');
    expect(onRecrop).toHaveBeenCalledWith({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('重新裁切拿不到主檔（別人上傳的圖）→ 提示不能裁切', async () => {
    fakeApi({ getAsset: vi.fn(async () => Promise.reject(new Error('404'))) });
    renderField({ assetId: 'asset-9' });
    await changeButton();
    await userEvent.click(screen.getByTestId('image-field-recrop'));
    expect(await screen.findByText(/無法重新裁切/)).toBeInTheDocument();
  });

  it('沒有登記選圖的 api：欄位停用，頁面照常顯示', async () => {
    renderField();
    expect(await screen.findByTestId('image-field-change')).toBeDisabled();
  });
});

describe('pastedImageName', () => {
  it('前綴＋本地時間＋副檔名（JPEG 用 jpg）', () => {
    expect(pastedImageName('貼上的圖片', new Date(2026, 9, 9, 14, 32), 'image/jpeg')).toBe(
      '貼上的圖片 2026-10-09 14:32.jpg',
    );
  });
});
