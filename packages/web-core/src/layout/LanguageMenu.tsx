import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';

import { useTranslation } from '../locales';
import { useLocaleStore } from '../store';

/** 超過兩種語言才需要選單；剛好兩種時按一下直接切到另一種。 */
const MENU_THRESHOLD = 2;

export interface LanguageMenuProps {
  /** 切換語系（各 app 決定要不要同步到帳號；偏好頁與這裡共用同一個函式，行為才不會分岔）。 */
  onChange: (language: Language) => void;
}

/** 頂列的語言快速切換；按鈕上顯示目前的語言。 */
export function LanguageMenu({ onChange: changeLocale }: LanguageMenuProps) {
  const { t } = useTranslation();
  const locale = useLocaleStore((state) => state.locale);

  if (SUPPORTED_LANGUAGES.length < MENU_THRESHOLD) return null;

  const icon = <Icon name="globe" size={16} />;

  if (SUPPORTED_LANGUAGES.length === MENU_THRESHOLD) {
    const next = SUPPORTED_LANGUAGES.find((language) => language !== locale) ?? locale;
    return (
      <Button
        variant="ghost"
        size="sm"
        startIcon={icon}
        aria-label={t('language.switchTo', { language: LANGUAGE_LABELS[next] })}
        title={t('language.switchTo', { language: LANGUAGE_LABELS[next] })}
        onClick={() => changeLocale(next)}
        data-testid="language-toggle"
      >
        {LANGUAGE_LABELS[locale]}
      </Button>
    );
  }

  return (
    <Menu
      align="end"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          startIcon={icon}
          aria-label={t('language.label')}
          data-testid="language-menu-trigger"
        >
          {LANGUAGE_LABELS[locale]}
        </Button>
      }
      items={SUPPORTED_LANGUAGES.map((language) => ({
        key: language,
        textValue: LANGUAGE_LABELS[language],
        label: (
          <span className="flex items-center gap-2">
            <span className="flex-1">{LANGUAGE_LABELS[language]}</span>
            {language === locale && (
              <Icon name="check" size={14} aria-label={t('language.current')} />
            )}
          </span>
        ),
        onSelect: () => changeLocale(language),
      }))}
    />
  );
}
