import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { Switch } from '@b2b-system/ui/Switch';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getApprovalFlowDetailQueryOptions } from '@/apis/approval-flow/get-approval-flow-detail/query';
import { getApprovalFlowListQueryOptions } from '@/apis/approval-flow/get-approval-flow-list/query';
import { VersionConflictAlert } from '@/core/components';

import { APPROVAL_FLOW_MAX_STEPS, APPROVAL_FLOW_TYPE_LABEL_KEY } from '../../constants';
import { addStep, moveStep, removeStep } from '../../hooks/flowDraft';
import { useApprovalFlowPermission } from '../../hooks/useApprovalFlowPermission';
import { useAssigneeKindAvailability } from '../../hooks/useAssigneeKindAvailability';
import { ApprovalFlowEditRoute, ApprovalFlowListRoute } from '../../routes';
import { FlowPreviewPanel } from './components/FlowPreviewPanel';
import { FlowStepCard } from './components/FlowStepCard';
import { useApprovalFlowEditor } from './useApprovalFlowEditor';

/** 某個審批類型的流程編輯（docs/architecture/backend/20-approval.md §9.16）：開關、關卡清單、右側試算。 */
export default function ApprovalFlowEditPage() {
  const { t } = useTranslation();
  const { type } = ApprovalFlowEditRoute.useParams();
  const permission = useApprovalFlowPermission();
  const detail = useQuery(getApprovalFlowDetailQueryOptions(type));
  // 各種規則能不能用只在列表端點；與列表頁共用快取
  const list = useQuery(getApprovalFlowListQueryOptions());
  const availability = useAssigneeKindAvailability(list.data?.assigneeKinds);
  const editor = useApprovalFlowEditor(type, detail.data);
  const readOnly = !permission.canUpdate;
  const typeLabelKey = APPROVAL_FLOW_TYPE_LABEL_KEY[type];
  const { draft } = editor;
  const fields = detail.data?.fields ?? [];
  const isAnonymous = detail.data?.requester === 'anonymous';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="approval-flow-edit-page">
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
          <h1 className="m-0 mt-1 text-xl font-semibold" data-testid="approval-flow-edit-title">
            {typeLabelKey ? t(typeLabelKey) : type}
          </h1>
          {detail.data?.flow && (
            <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">
              {t('approvalFlow.edit.version', { version: detail.data.flow.version })}
            </p>
          )}
        </div>
        {!readOnly && draft && (
          <div className="flex gap-2">
            <Button
              disabled={!editor.isDirty}
              onClick={editor.discard}
              data-testid="approval-flow-discard"
            >
              {t('approvalFlow.edit.discard')}
            </Button>
            <Button
              variant="primary"
              loading={editor.isSaving}
              disabled={!editor.isDirty && draft.version !== undefined}
              onClick={() => void editor.submit()}
              data-testid="approval-flow-save"
            >
              {t('common.save')}
            </Button>
          </div>
        )}
      </header>

      {detail.isPending && <Skeleton height={240} />}
      {detail.isError && (
        <QueryError
          error={detail.error}
          onRetry={() => void detail.refetch()}
          data-testid="approval-flow-edit-error"
        />
      )}

      {draft && detail.data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-4">
            {editor.conflictError && (
              <VersionConflictAlert
                error={editor.conflictError}
                onReload={() => void editor.reload()}
                reloading={editor.reloading}
                data-testid="approval-flow-conflict"
              />
            )}
            <FormError data-testid="approval-flow-form-error">{editor.formError}</FormError>
            <section className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{t('approvalFlow.edit.enabled')}</span>
                  <span className="block text-[var(--color-fg-muted)]">
                    {t('approvalFlow.edit.enabledHint')}
                  </span>
                </span>
                <Switch
                  aria-label={t('approvalFlow.edit.enabled')}
                  checked={draft.enabled}
                  disabled={readOnly}
                  onCheckedChange={(enabled) =>
                    editor.update((current) => ({ ...current, enabled }))
                  }
                  data-testid="approval-flow-enabled"
                />
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{t('approvalFlow.edit.allowRepeatApprover')}</span>
                  <span className="block text-[var(--color-fg-muted)]">
                    {t('approvalFlow.edit.allowRepeatApproverHint')}
                  </span>
                </span>
                <Switch
                  aria-label={t('approvalFlow.edit.allowRepeatApprover')}
                  checked={draft.allowRepeatApprover}
                  disabled={readOnly}
                  onCheckedChange={(allowRepeatApprover) =>
                    editor.update((current) => ({ ...current, allowRepeatApprover }))
                  }
                  data-testid="approval-flow-allow-repeat"
                />
              </div>
            </section>

            <ol
              className="m-0 flex list-none flex-col gap-3 p-0"
              data-testid="approval-flow-steps-editor"
            >
              {draft.steps.map((step, index) => (
                <FlowStepCard
                  key={step.id}
                  step={step}
                  index={index}
                  total={draft.steps.length}
                  fields={fields}
                  isAnonymous={isAnonymous}
                  availability={availability}
                  access={permission}
                  readOnly={readOnly}
                  errors={editor.errors}
                  isAssigneeRejected={editor.rejectedSteps.has(index)}
                  onChange={(change) =>
                    editor.update((current) => ({
                      ...current,
                      steps: current.steps.map((item) =>
                        item.id === step.id ? change(item) : item,
                      ),
                    }))
                  }
                  onMove={(delta) => editor.update((current) => moveStep(current, step.id, delta))}
                  onRemove={() => editor.update((current) => removeStep(current, step.id))}
                />
              ))}
            </ol>
            {!readOnly && (
              <div>
                <Button
                  startIcon={<Icon name="plus" size={16} />}
                  disabled={draft.steps.length >= APPROVAL_FLOW_MAX_STEPS}
                  onClick={() => editor.update(addStep)}
                  data-testid="approval-flow-step-add"
                >
                  {t('approvalFlow.step.add')}
                </Button>
              </div>
            )}
          </div>
          <aside>
            <FlowPreviewPanel
              type={type}
              draft={draft}
              fields={fields}
              isAnonymous={isAnonymous}
              canSearchUsers={permission.canSearchUsers}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
