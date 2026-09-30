import { Checkbox } from '@/components/Checkbox';
import { useConfirm } from '@/components/ConfirmDialog';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';

import { useUpdateTenantMutation } from '../../../hooks/useTenantMutations';

interface ExternalIdpSwitchProps {
  tenant: PlatformTenant;
  canUpdate: boolean;
}

/**
 * 是否允許租戶設定外部 IdP 連線（docs/adr/0020-physical-tenant-isolation.md D22）：
 * 連線本身由租戶的管理者在自己的 backstage 設定，平台只能開關。
 * 關閉會讓使用 SSO 的使用者立刻無法以外部帳號登入，所以先確認；打開直接生效。
 */
export function ExternalIdpSwitch({ tenant, canUpdate }: ExternalIdpSwitchProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateTenantMutation();

  const save = (allowExternalIdp: boolean) =>
    update.mutateAsync({ params: { id: tenant.id, body: { allowExternalIdp } } });

  const change = (checked: boolean) => {
    if (checked) {
      void save(true).catch(showError);
      return;
    }
    // 失敗時提示並重拋：確認框留著，讓使用者決定重試或取消
    void confirm({
      title: t('tenant.externalIdp.disableTitle'),
      description: t('tenant.externalIdp.disableConfirm', { code: tenant.code }),
      confirmLabel: t('tenant.externalIdp.disableAction'),
      tone: 'danger',
      onConfirm: () =>
        save(false).catch((caught: unknown) => {
          showError(caught);
          throw caught;
        }),
      'data-testid': 'tenant-external-idp-dialog',
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.externalIdp.title')}</h2>
      <Checkbox
        checked={tenant.allowExternalIdp}
        disabled={!canUpdate || update.isPending}
        onCheckedChange={change}
        label={t('tenant.externalIdp.allow')}
        description={t('tenant.externalIdp.description')}
        data-testid="tenant-allow-external-idp"
      />
    </section>
  );
}
