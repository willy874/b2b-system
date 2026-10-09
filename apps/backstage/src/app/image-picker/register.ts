import { registerImagePickerApi, registerImageSource } from '@b2b-system/web-core/image-picker';
import { lazy } from 'react';

import { getRecentImagesQueryOptions } from '@/apis/image/get-recent-images/query';

import { imagePickerApi } from './api';

/** 「最近使用」的本體只在打開選圖時才載入。 */
const RecentImageSource = lazy(() =>
  import('./RecentImageSource').then((module) => ({ default: module.RecentImageSource })),
);

/**
 * 選圖的 api 與內建的來源「最近使用」（docs/architecture/frontend/23-image-picker.md §2、§6）。在 app 的 plugin 的同步階段登記；
 * 檔案管理、圖片庫的來源由各自的 feature 登記。
 */
export function registerAppImagePicker(): void {
  registerImagePickerApi(imagePickerApi);
  registerImageSource({
    id: 'recent',
    order: 20,
    labelKey: 'image.recent.label',
    // 有沒有內容要先查：沒有任何最近使用的圖片時不列出這個分頁
    isAvailable: async ({ usage, queryClient }) =>
      (await queryClient.fetchQuery(getRecentImagesQueryOptions(usage.id))).items.length > 0,
    component: RecentImageSource,
  });
}
