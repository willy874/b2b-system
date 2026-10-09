import { imageSourceRegistry, resetImagePickerRegistry } from '@b2b-system/web-core/image-picker';
import type { ImageSourceContext } from '@b2b-system/web-core/image-picker';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAppImagePicker } from '../register';

const { fetchRecent } = vi.hoisted(() => ({ fetchRecent: vi.fn() }));
vi.mock('@/apis/image/get-recent-images/fetcher', () => ({ fetchRecentImagesQuery: fetchRecent }));

function context(): ImageSourceContext {
  return {
    usage: {
      id: 'user.avatar',
      maxSize: 1,
      contentTypes: [],
      minWidth: 1,
      minHeight: 1,
      aspectRatio: 1,
      presets: {},
      sources: null,
    },
    can: () => false,
    queryClient: new QueryClient(),
  };
}

describe('選圖的來源「最近使用」（docs/architecture/frontend/23-image-picker.md §6）', () => {
  beforeEach(() => {
    resetImagePickerRegistry();
    fetchRecent.mockReset();
  });

  it('有內容才列出（依用途查最近使用）', async () => {
    registerAppImagePicker();
    const source = imageSourceRegistry.get('recent');
    fetchRecent.mockResolvedValueOnce({ items: [] });
    expect(await source?.isAvailable?.(context())).toBe(false);
    fetchRecent.mockResolvedValueOnce({ items: [{ id: 'a' }] });
    expect(await source?.isAvailable?.(context())).toBe(true);
    expect(fetchRecent).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { usage: 'user.avatar' } }),
    );
  });
});
