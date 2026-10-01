import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getServiceAccountTokensQueryOptions } from '@/apis/service-account/get-service-account-tokens/query';
import { Button } from '@/components/Button';
import { ApiTokenCreateDialog, ApiTokenTable, QueryError } from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { PermissionKey } from '@/shared/api-sdk';

import { SERVICE_ACCOUNT_TOKEN_MAX_DAYS } from '../../../constants';
import {
  useServiceAccountTokenCreateMutation,
  useServiceAccountTokenRevokeMutation,
} from '../../../hooks/useServiceAccountMutations';

interface ServiceAccountTokenSectionProps {
  serviceAccountId: string;
  /** 停用的帳號不能用 token：不提供建立。 */
  active: boolean;
  canManage: boolean;
  scopeOptions: ReadonlyArray<{ key: PermissionKey; label: string }>;
}

/**
 * 它的 API token（ADR-0027 D2、D4）：token 只在對外 API 有效；建立時 token 取得的權限必須是操作者持有的，
 * 後端會擋（`AUTHZ_ESCALATION`，顯示在建立對話框裡）。
 */
export function ServiceAccountTokenSection({
  serviceAccountId,
  active,
  canManage,
  scopeOptions,
}: ServiceAccountTokenSectionProps) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const tokens = useQuery(getServiceAccountTokensQueryOptions(serviceAccountId));
  const createToken = useServiceAccountTokenCreateMutation();
  const revokeToken = useServiceAccountTokenRevokeMutation();

  return (
    <section className="flex flex-col gap-2" data-testid="service-account-token-section">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('serviceAccount.detail.tokens')}</h3>
        {canManage && active && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="service-account-token-create-button"
          >
            {t('apiToken.create.action')}
          </Button>
        )}
      </div>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">
        {t('serviceAccount.detail.tokensHint')}
      </p>
      {tokens.isError ? (
        <QueryError error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : (
        <ApiTokenTable
          tokens={tokens.data?.items}
          loading={tokens.isPending}
          canRevoke={canManage}
          onRevoke={(token) =>
            revokeToken.mutateAsync({ params: { serviceAccountId, tokenId: token.id } })
          }
          data-testid="service-account-token-table"
        />
      )}
      <ApiTokenCreateDialog
        open={creating}
        onOpenChange={setCreating}
        maxDays={SERVICE_ACCOUNT_TOKEN_MAX_DAYS}
        scopeOptions={scopeOptions}
        onCreate={(body) => createToken.mutateAsync({ params: { serviceAccountId, body } })}
      />
    </section>
  );
}
