import { Select } from '@b2b-system/ui/Select';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMfaMethodUis } from '@b2b-system/web-core/mfa';
import { useQuery } from '@tanstack/react-query';

import { fetchMfaMethodImpact } from '@/apis/platform-mfa-method/get-mfa-method-impact/fetcher';
import { getMfaMethodListQueryOptions } from '@/apis/platform-mfa-method/get-mfa-method-list/query';
import { useConfirmMfaMethodOff } from '@/core/mfa';
import type { PlatformTenant } from '@/shared/api-sdk';

import { useUpdateTenantFlagsMutation } from '../../../hooks/useTenantMutations';

const CHOICES = ['default', 'on', 'off'] as const;
type Choice = (typeof CHOICES)[number];

const choiceOf = (value: boolean | undefined): Choice =>
  value === undefined ? 'default' : value ? 'on' : 'off';

/**
 * 這個租戶的 MFA 方式開關（docs/architecture/backend/21-mfa.md §5）：「依全平台與預設」、開或關；送出完整的覆寫表。
 * 先對某個租戶開放新方式試行時用；全平台關掉的方式一律關。關掉前先顯示這個租戶會被擋在門外的人數。
 * 需要平台參數而還沒填齊的方式不能開啟（§5.1）。
 */
export function TenantMfaMethods({
  tenant,
  canUpdate,
}: {
  tenant: PlatformTenant;
  canUpdate: boolean;
}) {
  const { t } = useTranslation();
  const uis = useMfaMethodUis();
  const showError = useErrorToast();
  const confirmOff = useConfirmMfaMethodOff();
  const update = useUpdateTenantFlagsMutation();
  const { data } = useQuery(getMfaMethodListQueryOptions());
  const methods = (data?.items ?? []).filter((method) => method.realms.includes('tenant'));

  const change = (methodId: string, label: string, value: string) => {
    const choice = CHOICES.find((item) => item === value);
    if (!choice || choice === choiceOf(tenant.mfaMethods[methodId])) return;
    const next: Record<string, boolean> = { ...tenant.mfaMethods };
    if (choice === 'default') delete next[methodId];
    else next[methodId] = choice === 'on';
    const apply = () =>
      update.mutateAsync({ params: { id: tenant.id, body: { mfaMethods: next } } });
    if (choice !== 'off') {
      void apply().catch(showError);
      return;
    }
    void confirmOff({
      label,
      loadImpact: () => fetchMfaMethodImpact({ params: { id: methodId, tenantId: tenant.id } }),
      apply,
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.mfa.title')}</h2>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('tenant.mfa.description')}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {methods.map((method) => {
          const ui = uis.get(method.id);
          const label = ui ? t(ui.labelKey) : method.id;
          return (
            <li
              key={method.id}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="tenant-mfa-method"
              data-value={method.id}
            >
              <span className="flex flex-col">
                <span className="text-sm">{label}</span>
                {method.globalState === 'off' && (
                  <span className="text-xs text-[var(--color-danger-text)]">
                    {t('tenant.mfa.killed')}
                  </span>
                )}
                {method.settings?.configured === false && (
                  <span
                    className="text-xs text-[var(--color-fg-muted)]"
                    data-testid="tenant-mfa-method-unconfigured"
                  >
                    {t('tenant.mfa.unconfigured')}
                  </span>
                )}
              </span>
              <Select
                size="sm"
                value={choiceOf(tenant.mfaMethods[method.id])}
                options={CHOICES.map((choice) => ({
                  value: choice,
                  label: t(`tenant.flag.${choice}`),
                  // 平台參數沒有填齊之前不能對租戶開啟（docs/architecture/backend/21-mfa.md §5.1）
                  disabled: choice === 'on' && method.settings?.configured === false,
                }))}
                disabled={!canUpdate || update.isPending}
                onValueChange={(value) => change(method.id, label, value)}
                aria-label={label}
                data-testid="tenant-mfa-method-select"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
