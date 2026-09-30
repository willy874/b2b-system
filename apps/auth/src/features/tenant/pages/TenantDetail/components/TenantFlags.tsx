import { useQuery } from '@tanstack/react-query';

import { getFeatureFlagListQueryOptions } from '@/apis/platform-feature-flag/get-feature-flag-list/query';
import { useConfirm } from '@/components/ConfirmDialog';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { PermissionKey, usePermission } from '@/core/permission';
import type { FeatureFlag, PlatformTenant } from '@/shared/api-sdk';

import { useUpdateTenantFlagsMutation } from '../../../hooks/useTenantMutations';

/** 租戶層覆寫的三種選擇：`default` = 不覆寫（跟著全平台與預設值）。 */
const CHOICES = ['default', 'on', 'off'] as const;
type Choice = (typeof CHOICES)[number];

const CHOICE_LABEL_KEY = {
  default: 'tenant.flag.default',
  on: 'tenant.flag.on',
  off: 'tenant.flag.off',
} as const satisfies Record<Choice, string>;

const choiceOf = (value: boolean | undefined): Choice =>
  value === undefined ? 'default' : value ? 'on' : 'off';

interface TenantFlagsProps {
  tenant: PlatformTenant;
  canUpdate: boolean;
}

/**
 * 這個租戶的試行開關（docs/adr/0022-feature-flags.md D2、D7）：每個 flag 可以「依全平台與預設」、開或關；
 * 送出的是 **完整的覆寫表**（api 以整份取代）。全平台設為緊急關閉的 flag 一律關，這裡的設定暫時不生效。
 * 目錄與全平台狀態來自 `featureFlag:read`，沒有這個權限就不顯示這一區。
 */
export function TenantFlags({ tenant, canUpdate }: TenantFlagsProps) {
  const { t } = useTranslation();
  const { can } = usePermission();
  const canRead = can(PermissionKey['featureFlag:read']);
  const { data } = useQuery({ ...getFeatureFlagListQueryOptions(), enabled: canRead });
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateTenantFlagsMutation();

  const flags = data?.items ?? [];
  if (!canRead || flags.length === 0) return null;

  const options: SelectOption[] = CHOICES.map((choice) => ({
    value: choice,
    label: t(CHOICE_LABEL_KEY[choice]),
  }));

  const save = (flag: FeatureFlag, choice: Choice) => {
    const next: Record<string, boolean> = { ...tenant.flags };
    if (choice === 'default') delete next[flag.key];
    else next[flag.key] = choice === 'on';
    return update.mutateAsync({ params: { id: tenant.id, body: { flags: next } } });
  };

  const change = (flag: FeatureFlag, value: string) => {
    const choice = CHOICES.find((item) => item === value);
    if (!choice || choice === choiceOf(tenant.flags[flag.key])) return;
    if (choice !== 'off') {
      void save(flag, choice).catch(showError);
      return;
    }
    // 關掉會讓租戶的使用者立刻失去這個功能：先確認。失敗時提示並重拋，確認框留著
    void confirm({
      title: t('tenant.flag.offTitle'),
      description: t('tenant.flag.offConfirm', { code: tenant.code, key: flag.key }),
      confirmLabel: t('tenant.flag.off'),
      tone: 'danger',
      onConfirm: () =>
        save(flag, choice).catch((caught: unknown) => {
          showError(caught);
          throw caught;
        }),
      'data-testid': 'tenant-flag-dialog',
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.flag.title')}</h2>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('tenant.flag.description')}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {flags.map((flag) => (
          <li
            key={flag.key}
            className="flex flex-wrap items-center justify-between gap-2"
            data-testid="tenant-flag"
            data-value={flag.key}
          >
            <span className="flex flex-col">
              <code className="font-mono text-sm">{flag.key}</code>
              <span className="text-xs text-[var(--color-fg-muted)]">{flag.description}</span>
              {flag.globalState === 'off' && (
                <span
                  className="text-xs text-[var(--color-danger-text)]"
                  data-testid="tenant-flag-killed"
                >
                  {t('tenant.flag.killed')}
                </span>
              )}
            </span>
            <Select
              size="sm"
              value={choiceOf(tenant.flags[flag.key])}
              options={options}
              disabled={!canUpdate || update.isPending}
              onValueChange={(value) => change(flag, value)}
              aria-label={flag.key}
              data-testid="tenant-flag-select"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
