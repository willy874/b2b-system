import { z } from 'zod';

import { defineSetting, SettingCategory } from '@/core/settings';

/**
 * 每個資源至少保留最新的幾版（docs/architecture/backend/14-revisions.md §9.2 D1：保留「最新 N 版」∪「N 天內」）。
 * 下限 1：最新一版等於目前的內容，永遠保留；上限 1000。
 */
export const REVISION_KEEP_VERSIONS_SETTING = defineSetting({
  key: 'revision.keepVersions',
  category: SettingCategory.REVISION,
  schema: z.number().int().min(1).max(1000),
  defaultValue: 50,
  isPublic: false,
});

/** 這麼多天內的版本一律保留，不論是第幾版。1～3650 天。 */
export const REVISION_KEEP_DAYS_SETTING = defineSetting({
  key: 'revision.keepDays',
  category: SettingCategory.REVISION,
  schema: z.number().int().min(1).max(3650),
  defaultValue: 90,
  isPublic: false,
});

export const REVISION_SETTINGS = [REVISION_KEEP_VERSIONS_SETTING, REVISION_KEEP_DAYS_SETTING];
