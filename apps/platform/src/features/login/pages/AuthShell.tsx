import { AuthShell as CoreAuthShell } from '@b2b-system/web-core/components';
import type { AuthShellProps as CoreAuthShellProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

export type AuthShellProps = Omit<CoreAuthShellProps, 'brand'>;

/** web-core 的 `AuthShell`，產品名取自這個 app 的 `app.title`。 */
export function AuthShell(props: AuthShellProps) {
  const { t } = useTranslation();
  return <CoreAuthShell {...props} brand={t('app.title')} />;
}
