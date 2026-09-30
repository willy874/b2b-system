import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Table } from '@/components/Table';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { FeatureFlag } from '@/shared/api-sdk';

import {
  FEATURE_FLAG_GLOBAL_CHOICES,
  FEATURE_FLAG_GLOBAL_CONFIRM_KEY,
  FEATURE_FLAG_GLOBAL_LABEL_KEY,
} from '../../../constants';
import type { FeatureFlagGlobalChoice } from '../../../constants';
import { useUpdateFeatureFlagMutation } from '../../../hooks/useUpdateFeatureFlagMutation';

interface FeatureFlagTableProps {
  items: FeatureFlag[];
  loading: boolean;
  canUpdate: boolean;
  /** 今天（`YYYY-MM-DD`）；過了 `removeBy` 的 flag 標示「已過期」。 */
  today: string;
}

const choiceOf = (flag: FeatureFlag): FeatureFlagGlobalChoice => flag.globalState ?? 'default';

/**
 * 試行開關的列表（docs/adr/0022-feature-flags.md D8）。全平台狀態的每一次變更都先確認：
 * 會立即影響所有租戶；`off` 是緊急開關，以 danger 的語氣提示。
 */
export function FeatureFlagTable({ items, loading, canUpdate, today }: FeatureFlagTableProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateFeatureFlagMutation();

  const columns = useMemo<Array<ColumnDef<FeatureFlag, unknown>>>(() => {
    const options: SelectOption[] = FEATURE_FLAG_GLOBAL_CHOICES.map((choice) => ({
      value: choice,
      label: t(FEATURE_FLAG_GLOBAL_LABEL_KEY[choice]),
    }));

    const change = (flag: FeatureFlag, value: string) => {
      const state = FEATURE_FLAG_GLOBAL_CHOICES.find((choice) => choice === value);
      if (!state || state === choiceOf(flag)) return;
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
        cell: ({ row }) => (
          <span className="flex flex-col">
            <code className="font-mono text-sm">{row.original.key}</code>
            <span className="text-xs text-[var(--color-fg-muted)]">{row.original.description}</span>
          </span>
        ),
      },
      { id: 'owner', header: t('featureFlag.field.owner'), cell: ({ row }) => row.original.owner },
      {
        id: 'removeBy',
        header: t('featureFlag.field.removeBy'),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.removeBy}
            {row.original.removeBy < today && (
              <span
                className="rounded-[var(--radius-sm)] bg-[var(--color-danger)] px-1.5 text-xs text-[var(--color-danger-on)]"
                data-testid="feature-flag-expired"
                data-value={row.original.key}
              >
                {t('featureFlag.expired')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'default',
        header: t('featureFlag.field.default'),
        cell: ({ row }) =>
          row.original.defaultEnabled ? t('featureFlag.default.on') : t('featureFlag.default.off'),
      },
      {
        id: 'tenantOverrides',
        header: t('featureFlag.field.tenantOverrides'),
        cell: ({ row }) => t('featureFlag.tenantOverrides', row.original.tenantOverrides),
      },
      {
        id: 'global',
        header: t('featureFlag.field.global'),
        cell: ({ row }) => (
          <span data-testid="feature-flag-global" data-value={choiceOf(row.original)}>
            {canUpdate ? (
              <Select
                size="sm"
                value={choiceOf(row.original)}
                options={options}
                disabled={update.isPending}
                onValueChange={(value) => change(row.original, value)}
                aria-label={t('featureFlag.field.global')}
                data-testid="feature-flag-global-select"
              />
            ) : (
              t(FEATURE_FLAG_GLOBAL_LABEL_KEY[choiceOf(row.original)])
            )}
          </span>
        ),
      },
    ];
  }, [canUpdate, confirm, showError, t, today, update]);

  return (
    <Table
      data={items}
      columns={columns}
      loading={loading}
      getRowId={(row) => row.key}
      emptyTitle={t('featureFlag.empty')}
      data-testid="feature-flag-table"
    />
  );
}
