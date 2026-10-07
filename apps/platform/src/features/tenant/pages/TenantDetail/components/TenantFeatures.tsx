import { Button } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { getTenantFeatureImpactQueryOptions } from '@/apis/platform-tenant/get-tenant-feature-impact/query';
import type {
  PlatformTenant,
  TenantFeature,
  TenantFeatureImpact,
  TenantFeatureParam,
} from '@/shared/api-sdk';

import {
  TENANT_FEATURE_DESCRIPTION_KEY,
  TENANT_FEATURE_DISABLE_WARNING_KEY,
  TENANT_FEATURE_IMPACT_LABEL_KEY,
  TENANT_FEATURE_LABEL_KEY,
  TENANT_FEATURE_PARAM_LABEL_KEY,
  TENANT_FEATURES,
} from '../../../constants';
import { useUpdateTenantMutation } from '../../../hooks/useTenantMutations';
import { formatParamValue } from '../../../utils';
import { TenantFeatureParamDialog } from './TenantFeatureParamDialog';

interface TenantFeaturesProps {
  tenant: PlatformTenant;
  canUpdate: boolean;
}

/**
 * 租戶啟用的功能（docs/architecture/frontend/02-plugin-system.md §9.2 D8）：每個可啟用的 feature 一個開關，
 * 送出的是 **完整清單**（api 以整份取代）。關閉會讓租戶的使用者立刻失去該功能，所以先確認；打開直接生效。
 * 有參數的 feature 在那一列下列出參數（配額與上限，docs/architecture/05-tenancy.md §13.2 D5）：
 * 參數與開關無關，關閉時照常保留、照常生效。
 * 關閉前先問 api 這個 feature 現在影響多少東西（例：外部 IdP 的連線與沒有密碼的使用者），列在確認框裡；
 * 查不到時（網路、租戶 DB 暫時進不去）只顯示一般的說明，不擋住關閉。
 */
export function TenantFeatures({ tenant, canUpdate }: TenantFeaturesProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateTenantMutation();
  const queryClient = useQueryClient();
  const enabled = new Set(tenant.features);
  /** 正在查影響的 feature：查詢期間停用開關，避免連點開出兩個確認框。 */
  const [checking, setChecking] = useState<TenantFeature>();
  const [editing, setEditing] = useState<TenantFeatureParam>();

  const save = (features: TenantFeature[]) =>
    update.mutateAsync({ params: { id: tenant.id, body: { features } } });

  const impactOf = async (feature: TenantFeature): Promise<TenantFeatureImpact['items']> => {
    setChecking(feature);
    try {
      const impact = await queryClient.fetchQuery(
        getTenantFeatureImpactQueryOptions(tenant.id, feature),
      );
      return impact.items;
    } catch {
      // 數字只是輔助：查不到照樣讓管理者決定，確認框顯示一般的說明
      return [];
    } finally {
      setChecking(undefined);
    }
  };

  const change = async (feature: TenantFeature, checked: boolean) => {
    // 依固定順序送出：與 api 儲存的順序一致，也方便比對
    const next = TENANT_FEATURES.filter((id) => (id === feature ? checked : enabled.has(id)));
    if (checked) {
      void save(next).catch(showError);
      return;
    }
    const warningKey = TENANT_FEATURE_DISABLE_WARNING_KEY[feature];
    const message = t('tenant.feature.disableConfirm', {
      code: tenant.code,
      feature: t(TENANT_FEATURE_LABEL_KEY[feature]),
    });
    const impact = await impactOf(feature);
    // 失敗時提示並重拋：確認框留著，讓使用者決定重試或取消
    void confirm({
      title: t('tenant.feature.disableTitle'),
      description: (
        <DisableDescription
          message={warningKey ? `${message} ${t(warningKey, { code: tenant.code })}` : message}
          impact={impact}
        />
      ),
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
              disabled={!canUpdate || update.isPending || checking !== undefined}
              onCheckedChange={(checked) => void change(feature, checked)}
              label={t(TENANT_FEATURE_LABEL_KEY[feature])}
              description={t(TENANT_FEATURE_DESCRIPTION_KEY[feature])}
              data-testid="tenant-feature-toggle"
            />
            <FeatureParamList
              params={tenant.featureParams.filter((param) => param.feature === feature)}
              canUpdate={canUpdate}
              onEdit={setEditing}
            />
          </li>
        ))}
      </ul>
      <TenantFeatureParamDialog
        tenant={tenant}
        param={editing}
        onClose={() => setEditing(undefined)}
      />
    </section>
  );
}

interface DisableDescriptionProps {
  message: string;
  impact: TenantFeatureImpact['items'];
}

/** 關閉確認框的內容：一般的說明，加上目前受影響的數量（有的話）。 */
function DisableDescription({ message, impact }: DisableDescriptionProps): ReactNode {
  const { t } = useTranslation();
  const affected = impact.filter((item) => item.count > 0);
  return (
    <>
      <span className="block">{message}</span>
      {affected.length > 0 && (
        <span className="mt-2 block" data-testid="tenant-feature-impact">
          {t('tenant.feature.impactTitle')}
          {/* 確認框的說明是 <p>：不能放 <ul>，每一項一行 */}
          {affected.map((item) => (
            <span
              key={item.key}
              className="block pl-2"
              data-testid="tenant-feature-impact-item"
              data-value={item.key}
            >
              ・{t(TENANT_FEATURE_IMPACT_LABEL_KEY[item.key], { count: item.count })}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

interface FeatureParamListProps {
  params: TenantFeatureParam[];
  canUpdate: boolean;
  onEdit: (param: TenantFeatureParam) => void;
}

/** 一個 feature 的參數：名稱、生效值（帶單位）、改過的標示與編輯按鈕。 */
function FeatureParamList({ params, canUpdate, onEdit }: FeatureParamListProps) {
  const { t } = useTranslation();
  if (!params.length) return null;
  return (
    <dl className="m-0 mt-1 ml-7 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
      {params.map((param) => (
        <div key={param.key} className="contents" data-testid="tenant-param" data-value={param.key}>
          <dt className="text-[var(--color-fg-muted)]">
            {t(TENANT_FEATURE_PARAM_LABEL_KEY[param.key])}
          </dt>
          <dd className="m-0 flex items-center gap-2">
            <span data-testid="tenant-param-value">{formatParamValue(t, param, param.value)}</span>
            {param.overridden && (
              <span
                className="text-xs text-[var(--color-fg-muted)]"
                data-testid="tenant-param-overridden"
              >
                {t('tenant.param.overridden')}
              </span>
            )}
            {canUpdate && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEdit(param)}
                aria-label={t('tenant.param.edit', {
                  name: t(TENANT_FEATURE_PARAM_LABEL_KEY[param.key]),
                })}
                data-testid="tenant-param-edit"
              >
                {t('common.edit')}
              </Button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
