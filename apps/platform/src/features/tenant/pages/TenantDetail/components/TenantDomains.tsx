import { useState } from 'react';

import { Button, IconButton } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Tooltip } from '@/components/Tooltip';
import { useErrorMessage, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';

import { TENANT_DOMAIN_PATTERN } from '../../../constants';
import {
  useAddTenantDomainMutation,
  useRemoveTenantDomainMutation,
} from '../../../hooks/useTenantMutations';

interface TenantDomainsProps {
  tenant: PlatformTenant;
  canUpdate: boolean;
}

/**
 * 網域：第一個是主要網域（信中連結與進入租戶用它），不能移除；其他網域移除前要確認
 * （移除後那個網域立即無法進入租戶）。後端也擋主要網域（`TENANT_PRIMARY_DOMAIN`）。
 */
export function TenantDomains({ tenant, canUpdate }: TenantDomainsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const add = useAddTenantDomainMutation();
  const removeDomain = useRemoveTenantDomainMutation();
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string>();

  const submit = async () => {
    const value = domain.trim().toLowerCase();
    if (!TENANT_DOMAIN_PATTERN.test(value)) {
      setError(t('tenant.error.domainInvalid'));
      return;
    }
    setError(undefined);
    try {
      await add.mutateAsync({ params: { id: tenant.id, body: { domain: value } } });
      setDomain('');
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  // 失敗時提示並重拋：確認框留著，讓使用者決定重試或取消
  const confirmRemove = (item: string) =>
    void confirm({
      title: t('tenant.domain.removeTitle'),
      description: t('tenant.domain.removeConfirm', { domain: item }),
      confirmLabel: t('tenant.domain.removeAction'),
      tone: 'danger',
      onConfirm: () =>
        removeDomain
          .mutateAsync({ params: { id: tenant.id, domain: item } })
          .catch((caught: unknown) => {
            showError(caught);
            throw caught;
          }),
      'data-testid': 'tenant-domain-remove-dialog',
    });

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="m-0 text-base font-medium">{t('tenant.domain.title')}</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {tenant.domains.map((item, index) => (
          <li
            key={item}
            className="flex items-center gap-2 text-sm"
            data-testid="tenant-domain"
            data-value={item}
          >
            <code className="font-mono">{item}</code>
            {index === 0 ? (
              <Tooltip content={t('tenant.domain.primaryHint')}>
                <span
                  className="text-xs text-[var(--color-fg-muted)]"
                  data-testid="tenant-domain-primary"
                >
                  {t('tenant.domain.primary')}
                </span>
              </Tooltip>
            ) : (
              canUpdate && (
                <Tooltip content={t('tenant.domain.remove')}>
                  <IconButton
                    size="sm"
                    aria-label={t('tenant.domain.remove')}
                    disabled={removeDomain.isPending}
                    onClick={() => confirmRemove(item)}
                    data-testid="tenant-domain-remove"
                    data-value={item}
                  >
                    <Icon name="trash" size={16} />
                  </IconButton>
                </Tooltip>
              )
            )}
          </li>
        ))}
      </ul>
      {canUpdate && (
        <form
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('tenant.domain.add')} error={error} className="flex-1">
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="portal.example.com"
              data-testid="tenant-domain-input"
            />
          </Field>
          <Button type="submit" loading={add.isPending} data-testid="tenant-domain-add">
            {t('tenant.domain.addAction')}
          </Button>
        </form>
      )}
    </section>
  );
}
