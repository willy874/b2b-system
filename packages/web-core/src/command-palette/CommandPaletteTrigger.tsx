import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useMemo } from 'react';

import { formatHotkey, isMacPlatform } from '../hotkey';
import { useTranslation } from '../locales';
import { COMMAND_PALETTE_HOTKEY } from './constants';
import { useCommandPaletteStore } from './store';

/** 頂列的搜尋按鈕：不知道快捷鍵的人也找得到面板；名稱帶出快捷鍵。 */
export function CommandPaletteTrigger() {
  const { t } = useTranslation();
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const shortcut = useMemo(() => formatHotkey(COMMAND_PALETTE_HOTKEY, isMacPlatform()), []);
  const label = t('commandPalette.trigger', { shortcut });

  return (
    <IconButton
      aria-label={label}
      title={label}
      onClick={() => setOpen(true)}
      data-testid="command-palette-trigger"
    >
      <Icon name="search" size={16} />
    </IconButton>
  );
}
