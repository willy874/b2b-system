import { Checkbox } from '@/components/Checkbox';
import { useConfirm } from '@/components/ConfirmDialog';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant, TenantFeature } from '@/shared/api-sdk';

import {
  TENANT_FEATURE_DESCRIPTION_KEY,
  TENANT_FEATURE_DISABLE_WARNING_KEY,
  TENANT_FEATURE_LABEL_KEY,
  TENANT_FEATURES,
} from '../../../constants';
import { useUpdateTenantMutation } from '../../../hooks/useTenantMutations';

interface TenantFeaturesProps {
  tenant: PlatformTenant;
  canUpdate: boolean;
}

/**
 * 租戶啟用的功能（docs/adr/0021-runtime-feature-activation.md D8）：每個可啟用的 feature 一個開關，
 * 送出的是 **完整清單**（api 以整份取代）。關閉會讓租戶的使用者立刻失去該功能，所以先確認；打開直接生效。
 */
export function TenantFeatures({ tenant, canUpdate }: TenantFeaturesProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateTenantMutation();
  const enabled = new Set(tenant.features);

  const save = (features: TenantFeature[]) =>
    update.mutateAsync({ params: { id: tenant.id, body: { features } } });

  const change = (feature: TenantFeature, checked: boolean) => {
    // 依固定順序送出：與 api 儲存的順序一致，也方便比對
    const next = TENANT_FEATURES.filter((id) => (id === feature ? checked : enabled.has(id)));
    if (checked) {
      void save(next).catch(showError);
      return;
    }
    const warningKey = TENANT_FEATURE_DISABLE_WARNING_KEY[feature];
    const description = t('tenant.feature.disableConfirm', {
      code: tenant.code,
      feature: t(TENANT_FEATURE_LABEL_KEY[feature]),
    });
    // 失敗時提示並重拋：確認框留著，讓使用者決定重試或取消
    void confirm({
      title: t('tenant.feature.disableTitle'),
      description: warningKey
        ? `${description} ${t(warningKey, { code: tenant.code })}`
        : description,
      confirmLabel: t('tenant.feature.disableAction'),
      tone: 'danger',
      onConfirm: () =>
        save(next).catch((caught: unknown) => {
          showError(caught);
          throw caught;
        }),
      'data-testid': 'tenant-feature-dialog',
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.feature.title')}</h2>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('tenant.feature.description')}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {TENANT_FEATURES.map((feature) => (
          <li key={feature} data-testid="tenant-feature" data-value={feature}>
            <Checkbox
              checked={enabled.has(feature)}
              disabled={!canUpdate || update.isPending}
              onCheckedChange={(checked) => change(feature, checked)}
              label={t(TENANT_FEATURE_LABEL_KEY[feature])}
              description={t(TENANT_FEATURE_DESCRIPTION_KEY[feature])}
              data-testid="tenant-feature-toggle"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
