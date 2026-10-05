import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';

import { useTranslation } from '../locales';
import { useThemeStore } from '../store';
import { THEME_OPTIONS } from '../theme';

/** 頂列的主題快速切換；圖示顯示目前的「偏好」（跟隨系統時是螢幕圖示），不是解析後的深淺色。 */
export function ThemeMenu() {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const icon = THEME_OPTIONS.find((option) => option.value === theme)?.icon ?? 'monitor';

  return (
    <Menu
      align="end"
      trigger={
        <IconButton aria-label={t('theme.label')} data-testid="theme-menu-trigger">
          <Icon name={icon} size={16} />
        </IconButton>
      }
      items={THEME_OPTIONS.map((option) => ({
        key: option.value,
        textValue: t(option.labelKey),
        label: (
          <span className="flex items-center gap-2">
            <Icon name={option.icon} size={14} />
            <span className="flex-1">{t(option.labelKey)}</span>
            {option.value === theme && (
              <Icon name="check" size={14} aria-label={t('theme.current')} />
            )}
          </span>
        ),
        onSelect: () => setTheme(option.value),
      }))}
    />
  );
}
