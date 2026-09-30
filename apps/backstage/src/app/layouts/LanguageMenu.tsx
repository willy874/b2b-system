import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { useTranslation } from '@/core/locales';
import { useLocaleStore } from '@/core/store';
import { useChangeLocale } from '@/features/account';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@/shared/constants/lang';

/** 超過兩種語言才需要選單；剛好兩種時按一下直接切到另一種。 */
const MENU_THRESHOLD = 2;

/** 頂列的語言快速切換；按鈕上顯示目前的語言。 */
export function LanguageMenu() {
  const { t } = useTranslation();
  const locale = useLocaleStore((state) => state.locale);
  const changeLocale = useChangeLocale();

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
