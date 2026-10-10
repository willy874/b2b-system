import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 處理時移除原檔的位置資訊（GPS；docs/architecture/backend/26-gallery.md D5）。素材庫的圖會被很多人下載、拿去對外使用，
 * 預設移除；需要保留的租戶（例：實地勘查照片）可以關掉。只影響之後的上傳，不回頭處理既有的圖片。
 * 變體一律移除中繼資料、`exif` 欄一律不存 GPS，與這個設定無關。
 */
export const GALLERY_STRIP_ORIGINAL_LOCATION_SETTING = defineSetting({
  key: 'gallery.stripOriginalLocation',
  category: SettingCategory.GALLERY,
  feature: 'gallery',
  schema: z.boolean(),
  defaultValue: true,
  isPublic: false,
});

export const GALLERY_SETTINGS = [GALLERY_STRIP_ORIGINAL_LOCATION_SETTING];
