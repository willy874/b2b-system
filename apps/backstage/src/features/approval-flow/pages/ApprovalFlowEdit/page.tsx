import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getApprovalFlowDetailQueryOptions } from '@/apis/approval-flow/get-approval-flow-detail/query';
import { getApprovalFlowListQueryOptions } from '@/apis/approval-flow/get-approval-flow-list/query';
import { VersionConflictAlert } from '@/core/components';
import { SystemSettingsLayout } from '@/core/system-settings';
import type { ApprovalFlow } from '@/shared/api-sdk';

import {
  APPROVAL_FLOW_MAX_STEPS,
  APPROVAL_FLOW_OUTCOME_DEFAULT_KEY,
  APPROVAL_FLOW_OUTCOME_KEY,
  APPROVAL_FLOW_TYPE_LABEL_KEY,
} from '../../constants';
import { addStep, moveStep, removeStep } from '../../hooks/flowDraft';
import { useApprovalFlowPermission } from '../../hooks/useApprovalFlowPermission';
import { useAssigneeKindAvailability } from '../../hooks/useAssigneeKindAvailability';
import { ApprovalFlowEditRoute, ApprovalFlowListRoute } from '../../routes';
import { availableTemplates, draftFromTemplate } from '../../templates';
import { FlowPreviewPanel } from './components/FlowPreviewPanel';
import { FlowSettingsSection } from './components/FlowSettingsSection';
import { FlowStatsPanel } from './components/FlowStatsPanel';
import { FlowStepCard, stepCardElementId } from './components/FlowStepCard';
import { FlowSummary } from './components/FlowSummary';
import { FlowTemplatePicker } from './components/FlowTemplatePicker';
import { useApprovalFlowEditor } from './useApprovalFlowEditor';
import { useFlowPreview } from './useFlowPreview';
import { useSaveWithImpacts } from './useSaveWithImpacts';
import { useStepExpansion } from './useStepExpansion';

/** 流程還在載入時的欄位：固定的參考，下游的 memo 與 state 不會每次 render 都以為換了。 */
const NO_FIELDS: ApprovalFlow['fields'] = [];

/**
 * 某個審批類型的流程編輯（docs/architecture/backend/20-approval.md §9.16）：還沒有流程時先選範本；
 * 上方是整條流程的摘要（疊上自動試算的結果），下面是開關與關卡（已儲存的預設收合），右側是試算與實際運作。
 * 仍在系統設定的外框裡（「審批流程」分頁以路徑前綴保持選取），返回鈕回到分頁。
 */
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
  const fields = detail.data?.fields ?? NO_FIELDS;
  const isAnonymous = detail.data?.requester === 'anonymous';
  const preview = useFlowPreview({ type, draft, fields, isAnonymous });
  // 還沒有流程、能編輯：先選範本（選了「從空白開始」也算選過）
  const [templatePicked, setTemplatePicked] = useState(false);
  const showTemplates = Boolean(detail.data && !detail.data.flow && !readOnly && !templatePicked);
  const expansion = useStepExpansion(editor.errors, editor.rejectedSteps);
  const save = useSaveWithImpacts(detail.data, draft, editor.submit);
  const outcomeKey = APPROVAL_FLOW_OUTCOME_KEY[type] ?? APPROVAL_FLOW_OUTCOME_DEFAULT_KEY;

  return (
    <SystemSettingsLayout>
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
            <h2 className="m-0 mt-1 text-lg font-semibold" data-testid="approval-flow-edit-title">
              {typeLabelKey ? t(typeLabelKey) : type}
            </h2>
            {detail.data?.flow && (
              <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">
                {t('approvalFlow.edit.version', { version: detail.data.flow.version })}
              </p>
            )}
          </div>
          {!readOnly && draft && !showTemplates && (
            <div className="flex gap-2">
              <Button
                disabled={!editor.isDirty}
                onClick={() => {
                  editor.discard();
                  expansion.reset();
                  if (!detail.data?.flow) setTemplatePicked(false);
                }}
                data-testid="approval-flow-discard"
              >
                {t('approvalFlow.edit.discard')}
              </Button>
              <Button
                variant="primary"
                loading={editor.isSaving}
                disabled={!editor.isDirty && draft.version !== undefined}
                onClick={() => void save()}
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

        {showTemplates && (
          <FlowTemplatePicker
            templates={availableTemplates(isAnonymous, availability)}
            onPick={(template) => {
              editor.update(() => draftFromTemplate(template, t));
              setTemplatePicked(true);
            }}
          />
        )}

        {draft && detail.data && !showTemplates && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-4">
              {editor.conflictError && (
                <VersionConflictAlert
                  error={editor.conflictError}
                  onReload={() => void editor.reload()}
                  reloading={editor.reloading}
                  data-testid="approval-flow-conflict"
                />
              )}
              <FormError data-testid="approval-flow-form-error">{editor.formError}</FormError>
              <FlowSummary
                draft={draft}
                preview={preview.result}
                outcome={t(outcomeKey)}
                onSelect={(stepId) => expansion.reveal(stepId, stepCardElementId(stepId))}
              />
              <FlowSettingsSection
                draft={draft}
                readOnly={readOnly}
                onChange={(patch) => editor.update((current) => ({ ...current, ...patch }))}
              />

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
                    expanded={expansion.isExpanded(step, index)}
                    onToggle={() => expansion.toggle(step, index)}
                    requiredPermissions={detail.data.requiredPermissions}
                    onChange={(change) =>
                      editor.update((current) => ({
                        ...current,
                        steps: current.steps.map((item) =>
                          item.id === step.id ? change(item) : item,
                        ),
                      }))
                    }
                    onMove={(delta) =>
                      editor.update((current) => moveStep(current, step.id, delta))
                    }
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
            <aside className="flex flex-col gap-4">
              <FlowPreviewPanel
                preview={preview}
                fields={fields}
                isAnonymous={isAnonymous}
                canSearchUsers={permission.canSearchUsers}
              />
              <FlowStatsPanel type={type} />
            </aside>
          </div>
        )}
      </div>
    </SystemSettingsLayout>
  );
}
