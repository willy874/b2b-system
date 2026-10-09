import { imageSourceRegistry, resetImagePickerRegistry } from '@b2b-system/web-core/image-picker';
import type { ImageSourceContext } from '@b2b-system/web-core/image-picker';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerFileImageSource } from '../register';

function contextWith(keys: string[]): ImageSourceContext {
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
    can: (key) => keys.includes(key),
    queryClient: new QueryClient(),
  };
}

describe('選圖的來源「檔案管理」（docs/architecture/frontend/23-image-picker.md §7）', () => {
  beforeEach(() => resetImagePickerRegistry());

  it('進得了檔案管理器（file:access 或 file:read）才列出', () => {
    registerFileImageSource();
    const source = imageSourceRegistry.get('file');
    expect(source?.isAvailable?.(contextWith(['file:access']))).toBe(true);
    expect(source?.isAvailable?.(contextWith(['file:read']))).toBe(true);
    expect(source?.isAvailable?.(contextWith([]))).toBe(false);
  });
});
