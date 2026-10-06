import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import type { TableSearchProps, TableSettingsConfig } from '@b2b-system/web-core/components';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import {
  FEATURE_FLAG_GLOBAL_CHOICES,
  FEATURE_FLAG_GLOBAL_CONFIRM_KEY,
  FEATURE_FLAG_GLOBAL_LABEL_KEY,
  FEATURE_FLAG_GLOBAL_TONE,
} from '../../../constants';
import { useUpdateFeatureFlagMutation } from '../../../hooks/useUpdateFeatureFlagMutation';
import { FEATURE_FLAG_LIST_TABLE_ID } from '../../../preference';
import type { FeatureFlagRowVM } from '../adapter';

/** 欄位順序與顯示存在這台裝置（`web-core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const FEATURE_FLAG_TABLE_SETTINGS: TableSettingsConfig = { tableId: FEATURE_FLAG_LIST_TABLE_ID };

interface FeatureFlagTableProps {
  rows: FeatureFlagRowVM[];
  loading: boolean;
  /** `featureFlag:update`：切換全平台狀態（未水合時為 false，不閃現選單）。 */
  canUpdate: boolean;
  /** 表格上方常駐的關鍵字搜尋。 */
  searchBox: TableSearchProps;
  /** 列表查詢失敗（顯示錯誤與重試，不落到「沒有資料」）。 */
  error: unknown;
  onRetry: () => void;
}

/**
 * 試行開關的列表（docs/architecture/05-tenancy.md §11.2 D8）。全平台狀態的每一次變更都先確認：
 * 會立即影響所有租戶；`off` 是緊急開關，以 danger 的語氣提示。
 */
export function FeatureFlagTable({
  rows,
  loading,
  canUpdate,
  searchBox,
  error,
  onRetry,
}: FeatureFlagTableProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateFeatureFlagMutation();

  const columns = useMemo<Array<TableColumnDef<FeatureFlagRowVM>>>(() => {
    const options: SelectOption[] = FEATURE_FLAG_GLOBAL_CHOICES.map((choice) => ({
      value: choice,
      label: t(FEATURE_FLAG_GLOBAL_LABEL_KEY[choice]),
    }));

    const change = (flag: FeatureFlagRowVM, value: string) => {
      const state = FEATURE_FLAG_GLOBAL_CHOICES.find((choice) => choice === value);
      if (!state || state === flag.globalState) return;
      // 失敗時提示並重拋：確認框留著，讓使用者決定重試或取消
      void confirm({
        title: t('featureFlag.confirm.title', { key: flag.key }),
        description: t(FEATURE_FLAG_GLOBAL_CONFIRM_KEY[state]),
        confirmLabel: t(FEATURE_FLAG_GLOBAL_LABEL_KEY[state]),
        tone: state === 'off' ? 'danger' : 'primary',
        onConfirm: () =>
          update
            .mutateAsync({ params: { key: flag.key, body: { state } } })
            .catch((caught: unknown) => {
              showError(caught);
              throw caught;
            }),
        'data-testid': 'feature-flag-dialog',
      });
    };

    return [
      {
        id: 'key',
        header: t('featureFlag.field.key'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <code className="font-mono text-sm">{row.original.key}</code>
            <span className="text-xs text-[var(--color-fg-muted)]">{row.original.description}</span>
          </span>
        ),
      },
      {
        id: 'owner',
        header: t('featureFlag.field.owner'),
        enableSorting: false,
        cell: ({ row }) => row.original.owner,
      },
      {
        id: 'removeBy',
        header: t('featureFlag.field.removeBy'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.removeBy}
            {row.original.expired && (
              <Chip tone="danger" data-testid="feature-flag-expired" data-value={row.original.key}>
                {t('featureFlag.expired')}
              </Chip>
            )}
          </span>
        ),
      },
      {
        id: 'default',
        header: t('featureFlag.field.default'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.defaultEnabled ? (
            <Chip tone="success">{t('featureFlag.default.on')}</Chip>
          ) : (
            <Chip>{t('featureFlag.default.off')}</Chip>
          ),
      },
      {
        id: 'tenantOverrides',
        header: t('featureFlag.field.tenantOverrides'),
        enableSorting: false,
        cell: ({ row }) => t('featureFlag.tenantOverrides', row.original.tenantOverrides),
      },
      {
        id: 'global',
        header: t('featureFlag.field.global'),
        enableSorting: false,
        cell: ({ row }) => (
          <span data-testid="feature-flag-global" data-value={row.original.globalState}>
            {canUpdate ? (
              <Select
                size="sm"
                value={row.original.globalState}
                options={options}
                disabled={update.isPending}
                onValueChange={(value) => change(row.original, value)}
                aria-label={t('featureFlag.field.global')}
                data-testid="feature-flag-global-select"
              />
            ) : (
              <Chip tone={FEATURE_FLAG_GLOBAL_TONE[row.original.globalState]}>
                {t(FEATURE_FLAG_GLOBAL_LABEL_KEY[row.original.globalState])}
              </Chip>
            )}
          </span>
        ),
      },
    ];
  }, [canUpdate, confirm, showError, t, update]);

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      search={searchBox}
      error={error}
      onRetry={onRetry}
      settings={FEATURE_FLAG_TABLE_SETTINGS}
      // 沒有批次操作：不提供勾選欄
      enableRowSelection={false}
      // 有關鍵字時交給 RichTable 顯示「沒有符合條件」＋清除
      emptyTitle={searchBox.value ? undefined : t('featureFlag.empty')}
      data-testid="feature-flag-table"
    />
  );
}

const getRowId = (row: FeatureFlagRowVM) => row.key;
