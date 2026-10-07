import { Button } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { RadioGroup } from '@b2b-system/ui/Radio';
import { formatDateTime } from '@b2b-system/web-shared/date';
import type { ReactNode } from 'react';

import { IMPORT_MODE_HINT_KEY, IMPORT_MODE_LABEL_KEY } from '../data-transfer';
import type { ImportApi, ImportMode } from '../data-transfer';
import { useErrorMessage } from '../errors';
import { useTranslation } from '../locales';
import { useUnsavedChangesGuard } from '../router';
import { ImportMapping } from './ImportMapping';
import { ImportPreview } from './ImportPreview';
import { ImportResult } from './ImportResult';
import { ImportSetup } from './ImportSetup';
import { useImportWorkspace } from './useImportWorkspace';

export interface ImportWorkspaceProps {
  /** 匯入用到的 API，由 app 以 `apis/data-transfer/` 的 fetcher 組好傳入。 */
  api: ImportApi;
  /** 資源類型（後端登記的 `type`）。 */
  type: string;
  mode: ImportMode;
  /** 操作者有權限的模式（依 `GET /data-transfers/resources`）。 */
  modes: readonly ImportMode[];
  /** 切換模式（網址上的 `mode`）；有預覽資料時由未儲存提醒先確認。 */
  onModeChange: (mode: ImportMode) => void;
  /** 已送出的傳輸（網址上的 `transfer`）：重新整理或從通知回來時直接顯示進度與結果。 */
  transferId: string | null;
  onTransferChange: (transferId: string | null) => void;
  /** 結果連到紀錄的詳情。 */
  renderRecordLink?: (id: string) => ReactNode;
}

/**
 * 匯入頁（docs/architecture/backend/22-data-transfer.md §7.2、§8.3）：選模式 → 範本與欄位說明 → 上傳並分析 →（必要時）對應欄位 →
 * 預覽與修正 → 套用 → 結果。預覽的資料只在前端（加密的草稿接續重新整理），伺服器在送出套用前不保存任何東西（D21）。
 * 各資源的匯入頁只把 fetcher 與 `type` 交給它（例：使用者的 `/user/import`）。
 */
export function ImportWorkspace(props: ImportWorkspaceProps) {
  // 切換模式：預覽歸零（有預覽資料時，切換前已由未儲存提醒確認）
  return <Workspace key={`${props.type}:${props.mode}`} {...props} />;
}

function Workspace({
  api,
  type,
  mode,
  modes,
  onModeChange,
  transferId,
  onTransferChange,
  renderRecordLink,
}: ImportWorkspaceProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const workspace = useImportWorkspace({ api, type, mode });
  useUnsavedChangesGuard(workspace.dirty, {
    title: t('dataTransfer.import.leaveTitle'),
    description: t('dataTransfer.import.leaveDescription'),
  });

  if (transferId) {
    return (
      <ImportResult
        api={api}
        type={type}
        transferId={transferId}
        renderRecordLink={renderRecordLink}
        onReimport={(columns, rows, fileName) => {
          workspace.loadRows(columns, rows, fileName);
          onTransferChange(null);
        }}
        onNewImport={() => onTransferChange(null)}
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-5"
      data-testid="import-workspace"
      data-value={workspace.phase}
    >
      {modes.length > 1 && (
        <RadioGroup<ImportMode>
          value={mode}
          onValueChange={onModeChange}
          orientation="horizontal"
          options={modes.map((item) => ({
            value: item,
            label: t(IMPORT_MODE_LABEL_KEY[item]),
            description: t(IMPORT_MODE_HINT_KEY[item]),
          }))}
          aria-label={t('dataTransfer.import.mode')}
          data-testid="import-mode"
        />
      )}

      {workspace.draft && workspace.phase === 'setup' && (
        <output
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-4 py-3 text-sm"
          data-testid="import-draft"
        >
          <span className="flex-1">
            {t('dataTransfer.import.draftFound', {
              fileName: workspace.draft.fileName ?? t('dataTransfer.import.manualFileName'),
              rows: workspace.draft.rows,
              time: formatDateTime(new Date(workspace.draft.savedAt).toISOString()),
            })}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void workspace.discardDraft()}>
            {t('dataTransfer.import.draftDiscard')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void workspace.resumeDraft()}
            data-testid="import-draft-resume"
          >
            {t('dataTransfer.import.draftResume')}
          </Button>
        </output>
      )}

      {(workspace.phase === 'setup' || workspace.phase === 'analyzing') && (
        <>
          <ImportSetup
            api={api}
            type={type}
            mode={mode}
            sheets={workspace.sheets}
            analyzing={workspace.phase === 'analyzing'}
            onAnalyze={(file, options) => void workspace.analyze(file, options)}
            onManual={(columns) =>
              workspace.startManual(columns, t('dataTransfer.import.manualFileName'))
            }
          />
          {workspace.error !== null && <FormError>{errorMessage(workspace.error)}</FormError>}
        </>
      )}

      {workspace.phase === 'mapping' && workspace.mapping && (
        <>
          <ImportMapping
            mapping={workspace.mapping}
            busy={false}
            onConfirm={(selection) => void workspace.confirmMapping(selection)}
            onCancel={workspace.cancelMapping}
          />
          {workspace.error !== null && <FormError>{errorMessage(workspace.error)}</FormError>}
        </>
      )}

      {(workspace.phase === 'preview' || workspace.phase === 'submitting') && (
        <ImportPreview api={api} type={type} workspace={workspace} onSubmitted={onTransferChange} />
      )}
    </div>
  );
}
