import type { TranslationFacade } from '@b2b-system/web-core/locales';

import type { TenantFeatureParam } from '@/shared/api-sdk';

import { TENANT_FEATURE_PARAM_UNIT_KEY } from './constants';

/** 參數值帶單位（`90 天`、`2048 MB`）；「不限」的特殊值顯示「永久」；字串原樣顯示。 */
export function formatParamValue(
  t: TranslationFacade['t'],
  param: Pick<TenantFeatureParam, 'unit' | 'foreverValue'>,
  value: number | string,
): string {
  if (typeof value === 'number' && param.foreverValue !== null && value === param.foreverValue) {
    return t('tenant.param.forever');
  }
  if (typeof value === 'string' || !param.unit) return String(value);
  return t(TENANT_FEATURE_PARAM_UNIT_KEY[param.unit], { value: value.toLocaleString() });
}
