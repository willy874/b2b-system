import { imageSourceRegistry, resetImagePickerRegistry } from '@b2b-system/web-core/image-picker';
import type { ImageSourceContext } from '@b2b-system/web-core/image-picker';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetFileRegistry, useFileActions } from '@/core/file';

import { registerGalleryFileAction } from '../fileAction/register';
import { registerGalleryImageSource } from '../imageSource/register';

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

describe('圖片庫登記到其他 feature 的擴充點（docs/architecture/frontend/24-gallery.md §6、§7）', () => {
  beforeEach(() => {
    resetImagePickerRegistry();
    resetFileRegistry();
  });

  it('選圖的來源「圖片庫」：有 gallery:read 才列出；反註冊（feature 卸載）之後消失', () => {
    registerGalleryImageSource();
    const source = imageSourceRegistry.get('gallery');
    expect(source?.isAvailable?.(contextWith(['gallery:read']))).toBe(true);
    expect(source?.isAvailable?.(contextWith(['file:read']))).toBe(false);
    resetImagePickerRegistry();
    expect(imageSourceRegistry.get('gallery')).toBeUndefined();
  });

  it('檔案動作「加入圖片庫」：選取列與 LightBox，要 gallery:create；反註冊（feature 卸載）之後消失', () => {
    const off = registerGalleryFileAction();
    const ids = (placement: 'selectionBar' | 'lightbox') =>
      renderHook(() => useFileActions(placement)).result.current.map((action) => action.id);
    usePermissionStore.setState({ permissions: new Set(['gallery:create']), hydrated: true });
    expect(ids('selectionBar')).toEqual(['gallery.add']);
    expect(ids('lightbox')).toEqual(['gallery.add']);
    usePermissionStore.setState({ permissions: new Set(['gallery:read']), hydrated: true });
    expect(ids('selectionBar')).toEqual([]);
    usePermissionStore.setState({ permissions: new Set(['gallery:create']), hydrated: true });
    off();
    expect(ids('selectionBar')).toEqual([]);
  });
});
