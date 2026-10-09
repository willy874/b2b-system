import {
  registerImagePickerApi,
  resetImagePickerRegistry,
} from '@b2b-system/web-core/image-picker';
import type { ImagePickerApi } from '@b2b-system/web-core/image-picker';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import userZhTW from '../../../locales/zh_TW.json';
import { UserAvatarSection } from '../components/UserAvatarSection';

const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock('@/apis/user/update-user/fetcher', () => ({ fetchUserUpdateMutation: updateUser }));

const USER = {
  id: '44444444-4444-4444-8444-444444444444',
  displayName: 'Person',
  avatar: null,
  avatarImageId: 'asset-1',
  version: 3,
} as unknown as User;

const api: ImagePickerApi = {
  getUsages: async () => [
    {
      id: 'user.avatar',
      maxSize: 1024,
      contentTypes: ['image/png'],
      minWidth: 128,
      minHeight: 128,
      aspectRatio: 1,
      presets: { sm: 32 },
      sources: null,
    },
  ],
  upload: vi.fn(),
  fromSource: vi.fn(),
  getAsset: vi.fn(),
};

describe('UserAvatarSection（docs/architecture/frontend/23-image-picker.md §8）', () => {
  beforeAll(async () => {
    await initTestI18n(userZhTW);
  });

  beforeEach(() => {
    resetImagePickerRegistry();
    registerImagePickerApi(api);
    updateUser.mockReset();
  });

  it('有 user:update：可以更換；移除時帶目前看到的 version', async () => {
    updateUser.mockResolvedValue({ ...USER, roles: [] });
    renderWithPermissions(<UserAvatarSection user={USER} canUpdate />, ['user:update']);
    await waitFor(() => expect(screen.getByTestId('image-field-change')).toBeEnabled());
    screen.getByTestId('image-field-remove').click();
    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    expect(updateUser.mock.calls[0]?.[0]).toMatchObject({
      params: { userId: USER.id, body: { avatarImageId: null, version: 3 } },
    });
  });

  it('沒有 user:update：只顯示頭像，沒有更換', () => {
    renderWithPermissions(<UserAvatarSection user={USER} canUpdate={false} />, []);
    expect(screen.getByTestId('user-avatar')).toBeInTheDocument();
    expect(screen.queryByTestId('image-field-change')).not.toBeInTheDocument();
  });
});
