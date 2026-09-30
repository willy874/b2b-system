import type { SystemSetting } from '@/shared/api-sdk';

import type { SettingUnit } from './constants';

export type SettingValue = SystemSetting['value'];

/** 設定頁的一個欄位（`pages/SettingList/adapter.ts` 由 DTO 轉成）。 */
export interface SettingFieldView {
  key: string;
  type: SystemSetting['type'];
  /** 沒有對應的標籤（後端比前端新）時為 `undefined`，畫面以 key 顯示。 */
  labelKey?: string;
  descriptionKey?: string;
  unit?: SettingUnit;
  input?: 'timezone';
  /** 以下都是「存的值」（未換算單位）。 */
  value: SettingValue;
  defaultValue: SettingValue;
  isOverridden: boolean;
  minimum: number | null;
  maximum: number | null;
}

export interface SettingCategoryView {
  category: SystemSetting['category'];
  labelKey: string;
  fields: SettingFieldView[];
}
