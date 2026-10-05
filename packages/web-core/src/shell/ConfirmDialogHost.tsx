import { ConfirmDialogProvider } from '@b2b-system/ui/ConfirmDialog';
import type { ReactNode } from 'react';

import { useTranslation } from '../locales';

/** 掛上全域的 `useConfirm()`；`components/` 不依賴語系，預設按鈕文案在這裡以 `t()` 傳入。 */
export function ConfirmDialogHost({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialogProvider confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')}>
      {children}
    </ConfirmDialogProvider>
  );
}
