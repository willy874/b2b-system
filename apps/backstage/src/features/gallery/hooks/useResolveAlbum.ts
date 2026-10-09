import { useCallback } from 'react';

import type { AlbumChoice } from '../components/AlbumPicker';
import { useGalleryAlbumCreateMutation } from './useGalleryMutations';

/** 把相簿的選擇換成相簿 id：選「新建」時先建立（名稱重複的錯誤交給呼叫端的表單顯示）。 */
export function useResolveAlbum() {
  const create = useGalleryAlbumCreateMutation();
  const resolve = useCallback(
    async (choice: AlbumChoice): Promise<string | undefined> => {
      if (choice.kind === 'none') return undefined;
      if (choice.kind === 'existing') return choice.albumId;
      const album = await create.mutateAsync({ params: { body: { name: choice.name.trim() } } });
      return album.id;
    },
    [create],
  );
  return { resolve, isPending: create.isPending };
}
