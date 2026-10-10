import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

const MIB = 1024 * 1024;

/**
 * 單一檔案上限（位元組）。env `FILE_UPLOAD_MAX_SIZE` 是這次部署允許的上限，也是預設值；
 * 租戶只能在上限以內調小（docs/architecture/backend/12-settings.md §2）。
 * 不公開：前端上傳前讀 `GET /files/upload-policy`，那裡回的已經是生效值。
 */
export const FILE_UPLOAD_MAX_SIZE_SETTING = defineSetting({
  key: 'file.uploadMaxSize',
  category: SettingCategory.FILE,
  feature: 'file',
  schema: (env) => {
    const ceiling = env('FILE_UPLOAD_MAX_SIZE');
    // 測試會把 env 上限設得比 1 MiB 還小
    return z.number().int().min(Math.min(MIB, ceiling)).max(ceiling);
  },
  defaultValue: (env) => env('FILE_UPLOAD_MAX_SIZE'),
  isPublic: false,
});

export const FILE_SETTINGS = [FILE_UPLOAD_MAX_SIZE_SETTING];
