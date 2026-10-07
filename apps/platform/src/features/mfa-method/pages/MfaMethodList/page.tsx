import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { Select } from '@b2b-system/ui/Select';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMfaMethodUis } from '@b2b-system/web-core/mfa';
import { useToast } from '@b2b-system/web-core/notify';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMfaMethodImpact } from '@/apis/platform-mfa-method/get-mfa-method-impact/fetcher';
import {
  getMfaMethodListQueryOptions,
  MFA_METHOD_LIST_QUERY_KEY,
} from '@/apis/platform-mfa-method/get-mfa-method-list/query';
import { getUpdateMfaMethodMutationOptions } from '@/apis/platform-mfa-method/update-mfa-method/mutation';
import { useConfirmMfaMethodOff } from '@/core/mfa';
import { PermissionKey, usePermission } from '@/core/permission';
import type { PlatformMfaMethod } from '@/shared/api-sdk';

const STATES = ['default', 'on', 'off'] as const;
type State = (typeof STATES)[number];

/**
 * MFA 驗證方式的全平台開關（docs/architecture/backend/21-mfa.md §5、D4）：規則與 feature flag 相同——全平台 `off`
 * 蓋過租戶層（緊急開關，例：寄信服務故障時關掉 email），`on`／預設時租戶層的覆寫生效（在租戶詳情的「多重驗證」分頁設定）。
 */
export default function MfaMethodListPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const { can } = usePermission();
  const canUpdate = can(PermissionKey['mfaMethod:update']);
  const queryClient = useQueryClient();
  const uis = useMfaMethodUis();
  const list = useQuery(getMfaMethodListQueryOptions());
  const update = useMutation({
    ...getUpdateMfaMethodMutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [MFA_METHOD_LIST_QUERY_KEY] });
      toast.success(t('mfaMethod.saved'));
    },
  });
  const confirmOff = useConfirmMfaMethodOff();

  const labelOf = (method: PlatformMfaMethod) => {
    const ui = uis.get(method.id);
    return ui ? t(ui.labelKey) : method.id;
  };

  const change = (method: PlatformMfaMethod, value: string) => {
    const state = STATES.find((item) => item === value);
    if (!state || state === method.globalState) return;
    const apply = () => update.mutateAsync({ params: { id: method.id, state } });
    if (state !== 'off') {
      void apply().catch(showError);
      return;
    }
    void confirmOff({
      label: labelOf(method),
      loadImpact: () => fetchMfaMethodImpact({ params: { id: method.id } }),
      apply,
    });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4" data-testid="mfa-method-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('mfaMethod.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('mfaMethod.description')}</p>
      </header>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {list.data.items.map((method) => (
            <li
              key={method.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              data-testid="mfa-method"
              data-value={method.id}
            >
              <div className="flex min-w-0 flex-1 gap-3">
                <Icon name={uis.get(method.id)?.icon ?? 'shield'} size={20} />
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {labelOf(method)}
                    <code className="text-xs text-[var(--color-fg-muted)]">{method.id}</code>
                    <Chip
                      tone={method.effective ? 'success' : 'neutral'}
                      data-testid="mfa-method-effective"
                      data-value={String(method.effective)}
                    >
                      {method.effective ? t('mfaMethod.enabled') : t('mfaMethod.disabled')}
                    </Chip>
                    {method.globalState === 'off' && (
                      <Chip tone="danger">{t('mfaMethod.killed')}</Chip>
                    )}
                    {method.platformAdminEnabled && (
                      <Chip tone="brand">{t('mfaMethod.platformAdmins')}</Chip>
                    )}
                  </span>
                  <span className="text-xs text-[var(--color-fg-muted)]">
                    {t('mfaMethod.tenantOverrides', {
                      on: method.tenantOverrides.on,
                      off: method.tenantOverrides.off,
                    })}
                    {' · '}
                    {method.stats
                      ? t('mfaMethod.stats', {
                          factors: method.stats.tenantFactors,
                          tenants: method.stats.tenants,
                          time: formatDateTime(method.stats.computedAt),
                        })
                      : t('mfaMethod.noStats')}
                  </span>
                </div>
              </div>
              <Select
                size="sm"
                value={method.globalState}
                disabled={!canUpdate || update.isPending}
                onValueChange={(value) => change(method, value)}
                options={STATES.map((state: State) => ({
                  value: state,
                  label: t(`mfaMethod.state.${state}`),
                }))}
                aria-label={labelOf(method)}
                data-testid="mfa-method-select"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
