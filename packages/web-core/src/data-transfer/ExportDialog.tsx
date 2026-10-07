import { Button } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Dialog } from '@b2b-system/ui/Dialog';
import { FormError } from '@b2b-system/ui/FormError';
import { Progress } from '@b2b-system/ui/Progress';
import { RadioGroup } from '@b2b-system/ui/Radio';
import { createDictStorage } from '@b2b-system/web-shared/storage';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AppError, useErrorMessage } from '../errors';
import { useTranslation } from '../locales';
import { useToast } from '../notify';
import { EXPORT_FORMAT_HINT_KEY, EXPORT_FORMAT_LABEL_KEY } from './constants';
import { downloadFromUrl } from './download';
import type { DataTransferApi, ExportFormat } from './types';
import { useTransferQuery } from './useTransferQuery';

/** 上次選的欄位（偏好，以資源類型為鍵）。 */
const columnPreference = createDictStorage('data-transfer-export-columns');

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: DataTransferApi;
  /** 資源類型（後端登記的 `type`）。 */
  type: string;
  /** 已勾選的 id；有勾選時預設匯出它們。 */
  selectedIds?: readonly string[];
  /** 列表目前的篩選條件（列表 API 的同一個物件，去掉分頁）。 */
  filter: Record<string, unknown>;
  /** 符合目前篩選的筆數（列表的 total）。 */
  matchingTotal: number;
  /** 「選取全部符合」：範圍是篩選條件，不先把 id 抓回來（D3）。 */
  allMatchingSelected?: boolean;
  'data-testid'?: string;
}

type Scope = 'ids' | 'filter';

/**
 * 匯出對話框（docs/architecture/backend/22-data-transfer.md §8.2）：範圍、格式、欄位 → 建立匯出 → 等推播 → 完成時自動下載。
 * 「在背景繼續」關閉對話框後不自動下載：完成時會收到站內通知，從「我的匯入匯出」下載。
 */
export function ExportDialog(props: ExportDialogProps) {
  // 每次開啟重新掛載：範圍、格式、進度都從頭開始（關閉 = 在背景繼續，不保留對話框的狀態）
  return props.open ? <ExportDialogContent {...props} /> : null;
}

function ExportDialogContent({
  open,
  onOpenChange,
  api,
  type,
  selectedIds = [],
  filter,
  matchingTotal,
  allMatchingSelected,
  'data-testid': testId = 'export-dialog',
}: ExportDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const toMessage = useErrorMessage();
  const hasSelection = selectedIds.length > 0 && !allMatchingSelected;
  const [scope, setScope] = useState<Scope>(hasSelection ? 'ids' : 'filter');
  const [format, setFormat] = useState<ExportFormat>('csv');
  /** 使用者改過的欄位；`null` = 沿用上次的偏好（只留目前還有權讀的欄位）或全選。 */
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const downloaded = useRef<string | null>(null);

  const resources = useQuery({
    queryKey: api.resourcesKey,
    queryFn: ({ signal }) => api.fetchResources(signal),
    enabled: open,
  });
  const resource = resources.data?.items.find((item) => item.type === type);
  const available = useMemo(() => resource?.export?.columns ?? [], [resource]);

  const columns = useMemo(() => {
    if (chosen) return chosen;
    if (!available.length) return null;
    const saved = columnPreference.get<string[] | null>(type, null);
    const keys = available.map((column) => column.key);
    const restored = saved?.filter((key) => keys.includes(key));
    return restored?.length ? restored : keys;
  }, [available, chosen, type]);
  const setColumns = (update: string[] | ((current: string[] | null) => string[])) =>
    setChosen(typeof update === 'function' ? update(columns) : update);

  const create = useMutation({
    mutationFn: () =>
      api.createExport({
        type,
        format,
        scope:
          scope === 'ids' ? { kind: 'ids', ids: [...selectedIds] } : { kind: 'filter', filter },
        ...(columns && columns.length < available.length ? { columns } : {}),
      }),
    onSuccess: (transfer) => {
      if (columns) columnPreference.set(type, columns);
      setTransferId(transfer.id);
    },
  });
  const transfer = useTransferQuery(api, transferId).data ?? create.data;

  const cancel = useMutation({
    mutationFn: () =>
      transfer
        ? api.cancel(transfer.id, transfer.version)
        : Promise.reject(new Error('no transfer')),
  });

  // 完成：對話框還開著才自動下載（關閉 = 在背景繼續，§8.2 步驟 4）
  useEffect(() => {
    if (!open || !transfer || transfer.status !== 'completed' || downloaded.current === transfer.id)
      return;
    downloaded.current = transfer.id;
    if (transfer.totalRows === 0) return;
    void api.download(transfer.id).then(
      ({ url, fileName }) => {
        downloadFromUrl(url, fileName);
        toast.success(t('dataTransfer.export.done', { fileName }));
        onOpenChange(false);
      },
      (error: unknown) => toast.error(toMessage(error)),
    );
  }, [api, onOpenChange, open, t, toMessage, toast, transfer]);

  const running = transfer && (transfer.status === 'queued' || transfer.status === 'running');
  const failedMessage =
    transfer?.status === 'failed'
      ? toMessage(new AppError(transfer.errorCode ?? 'INTERNAL_ERROR', 0))
      : create.error
        ? toMessage(create.error)
        : null;
  const skipped =
    transfer && transfer.scopeKind === 'ids' && transfer.totalRows < selectedIds.length
      ? selectedIds.length - transfer.totalRows
      : 0;

  const footer = transfer ? (
    <>
      {running && (
        <Button
          variant="secondary"
          onClick={() => cancel.mutate()}
          loading={cancel.isPending}
          data-testid="export-cancel"
        >
          {t('dataTransfer.export.cancel')}
        </Button>
      )}
      <Button
        variant={running ? 'primary' : 'secondary'}
        onClick={() => onOpenChange(false)}
        data-testid="export-close"
      >
        {running ? t('dataTransfer.export.background') : t('dataTransfer.export.close')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="primary"
        onClick={() => create.mutate()}
        loading={create.isPending}
        disabled={!resource?.export || !columns?.length}
        data-testid="export-submit"
      >
        {t('dataTransfer.export.submit')}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dataTransfer.export.title', { resource: resource?.label ?? '' })}
      footer={footer}
      size="md"
      data-testid={testId}
    >
      {transfer ? (
        <div
          className="flex flex-col gap-3"
          data-testid="export-progress"
          data-value={transfer.status}
        >
          {running && (
            <Progress
              value={
                transfer.totalRows
                  ? Math.min(100, (transfer.processedRows / transfer.totalRows) * 100)
                  : null
              }
              label={
                transfer.status === 'queued'
                  ? t('dataTransfer.export.queued')
                  : t('dataTransfer.export.progress', {
                      processed: transfer.processedRows.toLocaleString(),
                      total: transfer.totalRows.toLocaleString(),
                    })
              }
            />
          )}
          {running && (
            <p className="m-0 text-sm text-[var(--color-fg-muted)]">
              {t('dataTransfer.export.backgroundNotice')}
            </p>
          )}
          {transfer.status === 'completed' && transfer.totalRows === 0 && (
            <p className="m-0" data-testid="export-empty">
              {t('dataTransfer.export.empty')}
            </p>
          )}
          {skipped > 0 && (
            <p className="m-0 text-sm text-[var(--color-warning-text)]">
              {t('dataTransfer.export.skipped', {
                selected: selectedIds.length,
                rows: transfer.totalRows,
                skipped,
              })}
            </p>
          )}
          {failedMessage && <FormError>{failedMessage}</FormError>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">{t('dataTransfer.export.scope')}</legend>
            <RadioGroup<Scope>
              value={scope}
              onValueChange={setScope}
              options={[
                ...(hasSelection
                  ? [
                      {
                        value: 'ids' as const,
                        label: t('dataTransfer.export.scopeSelected', {
                          selected: selectedIds.length,
                        }),
                      },
                    ]
                  : []),
                {
                  value: 'filter',
                  label: t('dataTransfer.export.scopeFilter', {
                    total: matchingTotal.toLocaleString(),
                  }),
                  description: resource?.export?.orderHint ?? undefined,
                },
              ]}
              aria-label={t('dataTransfer.export.scope')}
              data-testid="export-scope"
            />
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">
              {t('dataTransfer.export.format')}
            </legend>
            <RadioGroup<ExportFormat>
              value={format}
              onValueChange={setFormat}
              options={(resource?.export?.formats ?? ['csv']).map((item) => ({
                value: item,
                label: t(EXPORT_FORMAT_LABEL_KEY[item]),
                description: t(EXPORT_FORMAT_HINT_KEY[item]),
              }))}
              aria-label={t('dataTransfer.export.format')}
              data-testid="export-format"
            />
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">
              {t('dataTransfer.export.columns')}
            </legend>
            <Checkbox
              label={t('dataTransfer.export.selectAllColumns')}
              checked={columns?.length === available.length && available.length > 0}
              indeterminate={Boolean(columns?.length) && (columns?.length ?? 0) < available.length}
              onCheckedChange={(checked) =>
                setColumns(checked ? available.map((column) => column.key) : [])
              }
            />
            <div className="grid grid-cols-2 gap-2 pl-6">
              {available.map((column) => (
                <span key={column.key} data-testid="export-column" data-value={column.key}>
                  <Checkbox
                    label={column.label}
                    checked={columns?.includes(column.key) ?? false}
                    onCheckedChange={(checked) =>
                      setColumns((current) => {
                        const next = new Set(current ?? []);
                        if (checked) next.add(column.key);
                        else next.delete(column.key);
                        // 保持定義的順序
                        return available.map((item) => item.key).filter((key) => next.has(key));
                      })
                    }
                  />
                </span>
              ))}
            </div>
          </fieldset>
          {failedMessage && <FormError>{failedMessage}</FormError>}
        </div>
      )}
    </Dialog>
  );
}
