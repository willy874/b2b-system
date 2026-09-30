import type { SystemSetting } from '@/shared/api-sdk';

import { SETTING_CATEGORIES, SETTING_CATEGORY_LABEL_KEY, SETTING_FIELD } from '../../constants';
import type { SettingUnit } from '../../constants';
import type { SettingCategoryView } from '../../types';

/** 依分類分組（分類順序固定、分類內依後端的登記順序）；沒有任何設定的分類不顯示。 */
export function toSettingCategories(items: readonly SystemSetting[]): SettingCategoryView[] {
  return SETTING_CATEGORIES.map((category) => ({
    category,
    labelKey: SETTING_CATEGORY_LABEL_KEY[category],
    fields: items
      .filter((item) => item.category === category)
      .map((item) => {
        const config = SETTING_FIELD[item.key];
        return {
          key: item.key,
          type: item.type,
          labelKey: config?.labelKey,
          descriptionKey: config?.descriptionKey,
          unit: config?.unit,
          input: config?.input,
          value: item.value,
          defaultValue: item.defaultValue,
          isOverridden: item.isOverridden,
          minimum: item.minimum,
          maximum: item.maximum,
        };
      }),
  })).filter((view) => view.fields.length > 0);
}

/** 存的值 → 畫面上的值（例：位元組 → MiB，最多兩位小數）。 */
export function toDisplayNumber(raw: number, unit: SettingUnit | undefined): number {
  const scale = unit?.scale ?? 1;
  return scale === 1 ? raw : Math.round((raw / scale) * 100) / 100;
}

/** 畫面上的值 → 存的值（設定都是整數）。 */
export function toRawNumber(display: number, unit: SettingUnit | undefined): number {
  return Math.round(display * (unit?.scale ?? 1));
}
