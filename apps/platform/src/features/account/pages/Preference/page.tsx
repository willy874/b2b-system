import { Field } from '@b2b-system/ui/Field';
import { Select } from '@b2b-system/ui/Select';
import { HeaderToolbarSettings } from '@b2b-system/web-core/layout';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { usePreferenceLocales, usePreferenceSections } from '@b2b-system/web-core/preference';
import { useLocaleStore, useThemeStore, useTimezoneStore } from '@b2b-system/web-core/store';
import { THEME_OPTIONS } from '@b2b-system/web-core/theme';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';

import { useChangeLocale } from '../../hooks/useChangeLocale';

const TIMEZONES = ['Asia/Taipei', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles'];

/**
 * 偏好設定：結構同 backstage 的偏好頁。平台管理者的帳號沒有存偏好，
 * 語系、時區、主題與頂列工具都只存在這個瀏覽器（跨分頁同步）。
 */
export default function PreferencePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const locale = useLocaleStore((state) => state.locale);
  const changeLocale = useChangeLocale();
  const timezone = useTimezoneStore((state) => state.timezone);
  const setTimezone = useTimezoneStore((state) => state.setTimezone);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  // feature 註冊的分頁與列表；偏好頁不需要認識它們
  const sections = usePreferenceSections();
  usePreferenceLocales();

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="preference-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('account.preference.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('account.preference.description')}
        </p>
      </header>

      <Field label={t('account.field.locale')}>
        <Select
          value={locale}
          onValueChange={(value) => {
            changeLocale(value as Language);
            toast.success(t('account.preference.saved'));
          }}
          options={SUPPORTED_LANGUAGES.map((language) => ({
            value: language,
            label: LANGUAGE_LABELS[language],
          }))}
          data-testid="preference-locale"
        />
      </Field>

      <Field label={t('account.field.timezone')}>
        <Select
          value={timezone}
          onValueChange={(value) => {
            setTimezone(value);
            toast.success(t('account.preference.saved'));
          }}
          options={TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
          data-testid="preference-timezone"
        />
      </Field>

      <Field label={t('account.field.theme')}>
        <Select
          value={theme}
          onValueChange={(value) => {
            const option = THEME_OPTIONS.find((item) => item.value === value);
            if (!option) return;
            setTheme(option.value);
            toast.success(t('account.preference.saved'));
          }}
          options={THEME_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          data-testid="preference-theme"
        />
      </Field>

      {/* 不用 Field：Field 的 label 會綁到清單裡的第一個控制項（拖曳把手） */}
      <section aria-labelledby="preference-header-toolbar">
        <h2 id="preference-header-toolbar" className="m-0 text-base font-medium">
          {t('account.preference.headerToolbar')}
        </h2>
        <p className="mt-1 mb-2 text-sm text-[var(--color-fg-muted)]">
          {t('account.preference.headerToolbarHint')}
        </p>
        <HeaderToolbarSettings />
      </section>

      {sections.map((section) => (
        <section key={section.key} data-testid="preference-section" data-value={section.key}>
          <h2 className="mb-2 text-base font-medium">{t(section.labelI18nKey)}</h2>
          <section.Component />
        </section>
      ))}
    </div>
  );
}
