import { Injectable } from '@nestjs/common';

import type {
  MfaMethod,
  MfaMethodSettingsSpec,
  MfaSettingField,
  MfaSettingValues,
} from './mfa-method';

const SETTING_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** 這個欄位在目前的值之下是否必填（`requiredWhen` 的條件成立才算）。 */
export function isSettingRequired(field: MfaSettingField, values: MfaSettingValues): boolean {
  if (!field.required) return false;
  if (!field.requiredWhen) return true;
  return values[field.requiredWhen.key] === field.requiredWhen.equals;
}

/**
 * 參數的格式檢查（必填、`select` 的選項、長度、網址）：回傳欄位 → 原因代碼。方式自己的 `checkSettings` 在這之後才呼叫。
 * 原因代碼：`MFA_SETTING_REQUIRED`、`MFA_SETTING_INVALID_OPTION`、`MFA_SETTING_TOO_LONG`、`MFA_SETTING_INVALID_URL`。
 */
export function validateSettingValues(
  spec: MfaMethodSettingsSpec,
  values: MfaSettingValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = values[field.key];
    if (value === undefined || value === '') {
      if (isSettingRequired(field, values)) errors[field.key] = 'MFA_SETTING_REQUIRED';
      continue;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors[field.key] = 'MFA_SETTING_TOO_LONG';
    } else if (field.type === 'select' && !field.options?.includes(value)) {
      errors[field.key] = 'MFA_SETTING_INVALID_OPTION';
    } else if (field.type === 'url' && !/^https?:\/\//.test(value)) {
      errors[field.key] = 'MFA_SETTING_INVALID_URL';
    }
  }
  return errors;
}

/** 方式登記時檢查參數的定義（鍵的格式、重複、`select` 要有選項、`requiredWhen` 指向存在的欄位）。 */
export function assertSettingsSpec(methodId: string, spec: MfaMethodSettingsSpec): void {
  const keys = new Set<string>();
  for (const field of spec.fields) {
    if (!SETTING_KEY_PATTERN.test(field.key)) {
      throw new Error(`MFA 方式 ${methodId} 的參數 ${field.key} 必須是 camelCase`);
    }
    if (keys.has(field.key)) throw new Error(`MFA 方式 ${methodId} 的參數 ${field.key} 重複`);
    keys.add(field.key);
    if (field.type === 'select' && !field.options?.length) {
      throw new Error(`MFA 方式 ${methodId} 的參數 ${field.key} 是 select，必須有 options`);
    }
  }
  for (const field of spec.fields) {
    if (field.requiredWhen && !keys.has(field.requiredWhen.key)) {
      throw new Error(`MFA 方式 ${methodId} 的參數 ${field.key} 的 requiredWhen 指向不存在的欄位`);
    }
  }
}

interface SettingsSource {
  get(methodId: string): MfaSettingValues | null;
}

/**
 * 方式讀取平台參數的入口（docs/architecture/backend/21-mfa.md §5.1）：參數存在平台 DB（`mfa_method_settings`），
 * 由 `modules/mfa` 快取並在啟動時以 `bind` 接上；方式、租戶模組只依賴這裡，不依賴 `modules/mfa`（與 `MfaChallengeDelivery` 同一個做法）。
 * 讀取是同步的：可用方式的判斷（`MfaAvailability`）在每次登入都會做，不能每次查 DB。
 */
@Injectable()
export class MfaMethodSettings {
  private source?: SettingsSource;

  bind(source: SettingsSource): void {
    if (this.source) throw new Error('MfaMethodSettings 已經接上實作');
    this.source = source;
  }

  /** 已儲存的參數（機密已解密）；沒有儲存過是 null。 */
  get(methodId: string): MfaSettingValues | null {
    if (!this.source) throw new Error('MFA 的框架（modules/mfa）沒有載入');
    return this.source.get(methodId);
  }

  /** 讀取一定要有的參數：方式在可用時才會被呼叫，沒有參數代表狀態不一致（例：剛被刪除），丟例外讓這次請求失敗。 */
  require(methodId: string): MfaSettingValues {
    const values = this.get(methodId);
    if (!values) throw new Error(`MFA 方式 ${methodId} 沒有設定參數`);
    return values;
  }

  /** 不需要參數的方式一律是 true；需要的要所有必填欄位都有值。 */
  isConfigured(method: MfaMethod): boolean {
    const spec = method.definition.settings;
    if (!spec) return true;
    const values = this.source?.get(method.definition.id);
    if (!values) return false;
    return Object.keys(validateSettingValues(spec, values)).length === 0;
  }
}
