import type { ZodType } from 'zod';

import type { Env } from '../config/env.schema';

/** 設定值只允許純量：表單、稽核的前後差異與 OpenAPI 都不必處理巢狀結構。 */
export type SettingValue = string | number | boolean;

/**
 * 設定頁的分組。新增分類時同步前端 `features/system/constants.ts` 的標籤對照表。
 */
export const SettingCategory = {
  GENERAL: 'general',
  AUTH: 'auth',
  FILE: 'file',
  TRASH: 'trash',
  REVISION: 'revision',
} as const;

export type SettingCategory = (typeof SettingCategory)[keyof typeof SettingCategory];

/** 讀一個環境變數（`ConfigService.get` 的精簡版，定義檔不必依賴 Nest）。 */
export type EnvReader = <K extends keyof Env>(key: K) => Env[K];

/** 與基礎設施有關的設定以 env 當上限或預設值（docs/architecture/backend/12-settings.md §2）。 */
type EnvDependent<T> = T | ((env: EnvReader) => T);

export interface SettingDefinition<T extends SettingValue = SettingValue> {
  /** `<分類>.<名稱>`；存進資料庫與稽核，已發布的 key 不改名。 */
  key: string;
  category: SettingCategory;
  /**
   * 允許的範圍就寫在 schema 上：下限擋住會削弱安全性的值、上限擋住超出部署能力的值。
   * 任何存得進去的值都安全，所以修改只寫稽核、不走審批。
   */
  schema: EnvDependent<ZodType<T>>;
  defaultValue: EnvDependent<T>;
  /** `true`：未登入也讀得到（`GET /system/settings/public`），例如登入頁要知道是否開放註冊。 */
  isPublic: boolean;
}

/** 把 env 相依的部分算出來之後的定義；`SettingService` 啟動時算一次。 */
export interface ResolvedSetting<T extends SettingValue = SettingValue> {
  key: string;
  category: SettingCategory;
  schema: ZodType<T>;
  defaultValue: T;
  isPublic: boolean;
}

/** 讓 `settings.get(DEF)` 推導出值的型別。 */
export function defineSetting<T extends SettingValue>(
  definition: SettingDefinition<T>,
): SettingDefinition<T> {
  return definition;
}

function resolveEnvDependent<T>(value: EnvDependent<T>, env: EnvReader): T {
  // T 是純量或 Zod schema（物件），不會是函式：是函式就一定是 env 相依的寫法
  return typeof value === 'function' ? (value as (env: EnvReader) => T)(env) : value;
}

export function resolveSetting<T extends SettingValue>(
  definition: SettingDefinition<T>,
  env: EnvReader,
): ResolvedSetting<T> {
  const schema = resolveEnvDependent(definition.schema, env);
  const defaultValue = resolveEnvDependent(definition.defaultValue, env);
  // 預設值本身不合範圍是程式錯誤（例：env 的上限比預設值小）：啟動時就讓它失敗
  const parsed = schema.safeParse(defaultValue);
  if (!parsed.success) {
    throw new Error(`設定 ${definition.key} 的預設值不符合它的 schema：${parsed.error.message}`);
  }
  return {
    key: definition.key,
    category: definition.category,
    schema,
    defaultValue: parsed.data,
    isPublic: definition.isPublic,
  };
}
