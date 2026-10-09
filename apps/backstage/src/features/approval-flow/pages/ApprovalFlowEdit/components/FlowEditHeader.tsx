import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';

import { ApprovalFlowListRoute } from '../../../routes';

interface FlowEditHeaderProps {
  title: string;
  /** 已儲存的版本；還沒有流程時為 undefined。 */
  version: number | undefined;
  /** 顯示儲存、放棄修改、重設（能編輯、而且不在選範本）。 */
  showActions: boolean;
  isDirty: boolean;
  /** 還沒有流程：第一次儲存不必先改動。 */
  isNew: boolean;
  isSaving: boolean;
  isResetting: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onReset: () => void;
}

/**
 * 流程編輯頁的頁首：返回、類型名稱與版本；放棄修改（回到上次儲存的設定）、儲存（成功後回到分頁）、
 * 重設流程（刪掉已儲存的流程，回到單關審批；docs/architecture/backend/20-approval.md §12 D10）。
 */
export function FlowEditHeader({
  title,
  version,
  showActions,
  isDirty,
  isNew,
  isSaving,
  isResetting,
  onSave,
  onDiscard,
  onReset,
}: FlowEditHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <ButtonLink
          size="sm"
          variant="ghost"
          to={ApprovalFlowListRoute.to}
          startIcon={<Icon name="chevron-left" size={16} />}
          data-testid="approval-flow-back"
        >
          {t('approvalFlow.edit.back')}
        </ButtonLink>
        <h2 className="m-0 mt-1 text-lg font-semibold" data-testid="approval-flow-edit-title">
          {title}
        </h2>
        {version !== undefined && (
          <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">
            {t('approvalFlow.edit.version', { version })}
          </p>
        )}
      </div>
      {showActions && (
        <div className="flex gap-2">
          {version !== undefined && (
            <Button
              variant="ghost"
              loading={isResetting}
              disabled={isSaving}
              onClick={onReset}
              data-testid="approval-flow-reset"
            >
              {t('approvalFlow.reset.action')}
            </Button>
          )}
          <Button disabled={!isDirty} onClick={onDiscard} data-testid="approval-flow-discard">
            {t('approvalFlow.edit.discard')}
          </Button>
          <Button
            variant="primary"
            loading={isSaving}
            disabled={isResetting || (!isDirty && !isNew)}
            onClick={onSave}
            data-testid="approval-flow-save"
          >
            {t('common.save')}
          </Button>
        </div>
      )}
    </header>
  );
}
