import { render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addResourceBundle, resetLocaleRegistry, useTranslation } from '@/core/locales';
import { initTestI18n } from '@/test/i18n';

import { usePreferenceLocales } from '../hooks';
import { registerPreferenceTable, resetPreferenceRegistry } from '../registry';

function PreferenceProbe() {
  usePreferenceLocales();
  const { t } = useTranslation();
  // 與偏好頁的列表卡片相同：翻譯放在以 `t` 為依賴的 memo 裡
  const label = useMemo(() => t('lateFeature.title'), [t]);
  return <span>{label}</span>;
}

describe('usePreferenceLocales（docs/architecture/frontend/02-plugin-system.md §9）', () => {
  beforeAll(() => initTestI18n());
  beforeEach(() => {
    resetLocaleRegistry();
    resetPreferenceRegistry();
  });

  it('列表的 feature 晚一步安裝：語系包登記後自動載入，以 `t` 為依賴的 memo 也換成翻譯', async () => {
    registerPreferenceTable({
      id: 'late-list',
      labelI18nKey: 'lateFeature.title',
      columnLabelKeys: {},
      localeScope: 'feature-late-preference',
    });
    render(<PreferenceProbe />);
    expect(screen.getByText('lateFeature.title')).toBeInTheDocument();

    // plugin 的 onInit：在偏好頁已經掛上之後才登記語系包
    addResourceBundle(
      {
        'zh-TW': {
          translation: () => Promise.resolve({ default: { lateFeature: { title: '晚到的列表' } } }),
        },
      },
      { scope: 'feature-late-preference' },
    );

    expect(await screen.findByText('晚到的列表')).toBeInTheDocument();
  });
});
