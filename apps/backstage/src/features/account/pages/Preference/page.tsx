import { Field } from '@b2b-system/ui/Field';
import { Select } from '@b2b-system/ui/Select';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { HeaderToolbarSettings } from '@b2b-system/web-core/layout';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { PreferenceSections, usePreferenceLocales } from '@b2b-system/web-core/preference';
import { useLocaleStore, useThemeStore, useTimezoneStore } from '@b2b-system/web-core/store';
import { THEME_OPTIONS } from '@b2b-system/web-core/theme';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';
import { supportedTimeZones } from '@b2b-system/web-shared/date';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { invalidateResources, selfUpdated } from '@/apis/resources';

import { useChangeLocale } from '../../hooks/useChangeLocale';

export default function PreferencePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const locale = useLocaleStore((state) => state.locale);
  const changeLocale = useChangeLocale();
  const timezone = useTimezoneStore((state) => state.timezone);
  const setTimezone = useTimezoneStore((state) => state.setTimezone);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const errorToast = useErrorToast();
  const sync = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => invalidateResources([selfUpdated(updated)]),
    onError: errorToast,
  });
  const timezoneOptions = useMemo(
    () => supportedTimeZones(timezone).map((zone) => ({ value: zone, label: zone })),
    [timezone],
  );

  // feature 或 web-core 註冊的分頁由 <PreferenceSections /> 渲染；偏好頁不需要認識它們。
  // 晚一步安裝的 feature（docs/architecture/frontend/02-plugin-system.md §9）登記的分頁與列表：補載它們的語系包
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
          // 「已儲存」等同步到帳號成功才顯示；失敗時 useChangeLocale 顯示錯誤
          onValueChange={(value) =>
            changeLocale(value as Language, {
              onSaved: () => toast.success(t('account.preference.saved')),
            })
          }
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
            sync.mutate(
              { params: { preferences: { timezone: value } } },
              { onSuccess: () => toast.success(t('account.preference.saved')) },
            );
          }}
          options={timezoneOptions}
          searchable
          data-testid="preference-timezone"
        />
      </Field>

      {/* 主題只存在本機，不呼叫 sync */}
      <Field label={t('account.field.theme')} description={t('account.preference.themeHint')}>
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

      <PreferenceSections />
    </div>
  );
}
