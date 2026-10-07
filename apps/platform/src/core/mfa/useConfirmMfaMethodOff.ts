import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';

/**
 * 關掉 MFA 方式之前先看影響（docs/architecture/backend/21-mfa.md §5）：只剩這種方式、沒有備用碼的人會無法登入（D8）。
 * 回傳的函式在確認後執行 `apply`；取消回 false。全平台與租戶層共用；影響人數由呼叫端以 `apis/` 取得（`core/` 不碰 api）。
 */
export function useConfirmMfaMethodOff() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  return async (input: {
    label: string;
    loadImpact: () => Promise<{ stranded: number }>;
    apply: () => Promise<unknown>;
  }): Promise<boolean> => {
    let stranded: number;
    try {
      stranded = (await input.loadImpact()).stranded;
    } catch (error) {
      showError(error);
      return false;
    }
    return confirm({
      title: t('mfaMethodOff.title', { name: input.label }),
      description:
        stranded > 0 ? t('mfaMethodOff.stranded', { count: stranded }) : t('mfaMethodOff.noImpact'),
      confirmLabel: t('mfaMethodOff.confirm'),
      tone: 'danger',
      onConfirm: () =>
        input.apply().catch((caught: unknown) => {
          showError(caught);
          throw caught;
        }),
      'data-testid': 'mfa-method-off-dialog',
    });
  };
}
