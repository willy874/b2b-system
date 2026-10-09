import type { ImagePickerApi, PickedImageAsset } from '@b2b-system/web-core/image-picker';

import { fetchCreateImageFromSourceMutation } from '@/apis/image/create-image-from-source/fetcher';
import { fetchImageUsagesQuery } from '@/apis/image/get-image-usages/fetcher';
import { fetchImageQuery } from '@/apis/image/get-image/fetcher';
import { uploadImage } from '@/apis/image/upload-image/fetcher';
import type { ImageAsset } from '@/shared/api-sdk';

function toPicked(asset: ImageAsset): PickedImageAsset {
  return {
    id: asset.id,
    status: asset.status,
    failureReason: asset.failureReason,
    image: asset.image,
    original: asset.original,
    crop: asset.crop,
  };
}

/**
 * 選圖要打的 api（`web-core/image-picker` 不呼叫 app 的 API，由這裡注入；docs/architecture/frontend/23-image-picker.md §3）。
 * 放在 `app/` 而不是 `core/`：`core/` 不能 import `apis/`（docs/coding-standards/07-layer-dependencies.md §2.2）。
 */
export const imagePickerApi: ImagePickerApi = {
  getUsages: async () => (await fetchImageUsagesQuery({ params: undefined })).items,
  upload: async (input) => toPicked(await uploadImage(input)),
  fromSource: async ({ usage, source, refId, crop }) =>
    toPicked(await fetchCreateImageFromSourceMutation({ params: { usage, source, refId, crop } })),
  getAsset: async (id) => toPicked(await fetchImageQuery({ params: { id } })),
};
