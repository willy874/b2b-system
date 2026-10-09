import type { SystemSetting } from '@/shared/api-sdk';

type SettingCategory = SystemSetting['category'];

/** 分類的顯示順序與標題。後端新增分類時 `satisfies` 讓這裡編譯失敗。 */
export const SETTING_CATEGORIES: readonly SettingCategory[] = [
  'general',
  'auth',
  'file',
  'trash',
  'revision',
  'notification',
  'dataTransfer',
  'gallery',
];

export const SETTING_CATEGORY_LABEL_KEY = {
  general: 'setting.category.general',
  auth: 'setting.category.auth',
  file: 'setting.category.file',
  trash: 'setting.category.trash',
  revision: 'setting.category.revision',
  notification: 'setting.category.notification',
  dataTransfer: 'setting.category.dataTransfer',
  gallery: 'setting.category.gallery',
} as const satisfies Record<SettingCategory, string>;

const MIB = 1024 * 1024;

/** 單位的顯示方式：`scale` 是「存的值 ÷ scale = 畫面上的值」（位元組以 MiB 顯示）。 */
export interface SettingUnit {
  labelKey: string;
  scale: number;
}

export interface SettingFieldConfig {
  labelKey: string;
  descriptionKey: string;
  unit?: SettingUnit;
  /** 字串設定的輸入方式；目前只有時區。 */
  input?: 'timezone';
}

const UNIT = {
  times: { labelKey: 'setting.unit.times', scale: 1 },
  seconds: { labelKey: 'setting.unit.seconds', scale: 1 },
  hours: { labelKey: 'setting.unit.hours', scale: 1 },
  days: { labelKey: 'setting.unit.days', scale: 1 },
  versions: { labelKey: 'setting.unit.versions', scale: 1 },
  items: { labelKey: 'setting.unit.items', scale: 1 },
  people: { labelKey: 'setting.unit.people', scale: 1 },
  characters: { labelKey: 'setting.unit.characters', scale: 1 },
  mebibytes: { labelKey: 'setting.unit.mebibytes', scale: MIB },
} as const satisfies Record<string, SettingUnit>;

/**
 * 每個設定的標籤與說明（key 與後端的 `*.settings.ts` 相同）。
 * 後端新增了這裡沒有的 key 時，設定頁以 key 本身當標籤顯示，不會壞掉。
 */
export const SETTING_FIELD: Readonly<Partial<Record<string, SettingFieldConfig>>> = {
  'general.defaultTimezone': {
    labelKey: 'setting.field.defaultTimezone.label',
    descriptionKey: 'setting.field.defaultTimezone.description',
    input: 'timezone',
  },
  'auth.loginMaxAttempts': {
    labelKey: 'setting.field.loginMaxAttempts.label',
    descriptionKey: 'setting.field.loginMaxAttempts.description',
    unit: UNIT.times,
  },
  'auth.loginLockoutSeconds': {
    labelKey: 'setting.field.loginLockoutSeconds.label',
    descriptionKey: 'setting.field.loginLockoutSeconds.description',
    unit: UNIT.seconds,
  },
  'auth.passwordMinLength': {
    labelKey: 'setting.field.passwordMinLength.label',
    descriptionKey: 'setting.field.passwordMinLength.description',
    unit: UNIT.characters,
  },
  'auth.registrationEnabled': {
    labelKey: 'setting.field.registrationEnabled.label',
    descriptionKey: 'setting.field.registrationEnabled.description',
  },
  'auth.activationTtlHours': {
    labelKey: 'setting.field.activationTtlHours.label',
    descriptionKey: 'setting.field.activationTtlHours.description',
    unit: UNIT.hours,
  },
  'auth.passwordResetTtlHours': {
    labelKey: 'setting.field.passwordResetTtlHours.label',
    descriptionKey: 'setting.field.passwordResetTtlHours.description',
    unit: UNIT.hours,
  },
  'auth.personalTokenMaxDays': {
    labelKey: 'setting.field.personalTokenMaxDays.label',
    descriptionKey: 'setting.field.personalTokenMaxDays.description',
    unit: UNIT.days,
  },
  'auth.serviceAccountTokenMaxDays': {
    labelKey: 'setting.field.serviceAccountTokenMaxDays.label',
    descriptionKey: 'setting.field.serviceAccountTokenMaxDays.description',
    unit: UNIT.days,
  },
  'file.uploadMaxSize': {
    labelKey: 'setting.field.uploadMaxSize.label',
    descriptionKey: 'setting.field.uploadMaxSize.description',
    unit: UNIT.mebibytes,
  },
  'trash.retentionDays': {
    labelKey: 'setting.field.retentionDays.label',
    descriptionKey: 'setting.field.retentionDays.description',
    unit: UNIT.days,
  },
  'dataTransfer.retentionDays': {
    labelKey: 'setting.field.dataTransferRetentionDays.label',
    descriptionKey: 'setting.field.dataTransferRetentionDays.description',
    unit: UNIT.days,
  },
  'gallery.stripOriginalLocation': {
    labelKey: 'setting.field.galleryStripOriginalLocation.label',
    descriptionKey: 'setting.field.galleryStripOriginalLocation.description',
  },
  'revision.keepVersions': {
    labelKey: 'setting.field.keepVersions.label',
    descriptionKey: 'setting.field.keepVersions.description',
    unit: UNIT.versions,
  },
  'revision.keepDays': {
    labelKey: 'setting.field.keepDays.label',
    descriptionKey: 'setting.field.keepDays.description',
    unit: UNIT.days,
  },
  'notification.retentionDays': {
    labelKey: 'setting.field.notificationRetentionDays.label',
    descriptionKey: 'setting.field.notificationRetentionDays.description',
    unit: UNIT.days,
  },
  'notification.maxPerUser': {
    labelKey: 'setting.field.notificationMaxPerUser.label',
    descriptionKey: 'setting.field.notificationMaxPerUser.description',
    unit: UNIT.items,
  },
  'announcement.dispatchRetentionDays': {
    labelKey: 'setting.field.announcementDispatchRetentionDays.label',
    descriptionKey: 'setting.field.announcementDispatchRetentionDays.description',
    unit: UNIT.days,
  },
  'announcement.maxRecipients': {
    labelKey: 'setting.field.announcementMaxRecipients.label',
    descriptionKey: 'setting.field.announcementMaxRecipients.description',
    unit: UNIT.people,
  },
};
