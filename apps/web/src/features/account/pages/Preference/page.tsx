import { useMutation } from '@tanstack/react-query';

import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { invalidateResources, selfUpdated } from '@/apis/resources';
import { Field } from '@/components/Field';
import { Select } from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/core/locales';
import { getPreferenceSections } from '@/core/preference';
import { useLocaleStore, useTimezoneStore } from '@/core/store';
import { Languages } from '@/shared/constants/lang';
import type { Language } from '@/shared/constants/lang';

const TIMEZONES = ['Asia/Taipei', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles'];

export default function PreferencePage() {
  const { t, changeLanguage } = useTranslation();
  const toast = useToast();
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const timezone = useTimezoneStore((state) => state.timezone);
  const setTimezone = useTimezoneStore((state) => state.setTimezone);

  const sync = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => invalidateResources([selfUpdated(updated)]),
  });

  // feature 或 plugins/features/* 註冊的分頁；偏好頁不需要認識它們
  const sections = getPreferenceSections();

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
            const next = value as Language;
            setLocale(next);
            void changeLanguage(next);
            sync.mutate({ params: { preferences: { locale: next } } });
            toast.success(t('account.preference.saved'));
          }}
          options={[
            { value: Languages.ZH_TW, label: '繁體中文' },
            { value: Languages.EN_US, label: 'English' },
          ]}
          data-testid="preference-locale"
        />
      </Field>

      <Field label={t('account.field.timezone')}>
        <Select
          value={timezone}
          onValueChange={(value) => {
            setTimezone(value);
            sync.mutate({ params: { preferences: { timezone: value } } });
            toast.success(t('account.preference.saved'));
          }}
          options={TIMEZONES.map((zone) => ({ value: zone, label: zone }))}
          data-testid="preference-timezone"
        />
      </Field>

      {sections.map((section) => (
        <section key={section.key} data-testid="preference-section" data-value={section.key}>
          <h2 className="mb-2 text-base font-medium">{t(section.labelI18nKey)}</h2>
          <section.Component />
        </section>
      ))}
    </div>
  );
}
