import { useState } from 'react';

import { Button } from '@/components/Button';
import { ApiTokenCreateDialog, ApiTokenTable, QueryError } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { PERSONAL_TOKEN_MAX_DAYS, useMyApiTokens } from '../../../hooks/useMyApiTokens';

/**
 * 個人 API token（docs/architecture/06-external-api.md §9.2 D2、D5）：代表自己呼叫對外 API，給個人的腳本用。
 * 權限最多與自己相同，可以再限縮；改密碼、被強制登出、被停用時一律失效。
 */
export function ProfileApiTokenSection() {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const { tokens, create, revoke, scopeOptions } = useMyApiTokens();

  return (
    <section className="flex flex-col gap-2" data-testid="profile-api-tokens">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-base font-medium">{t('account.apiToken.title')}</h2>
        <Button size="sm" onClick={() => setCreating(true)} data-testid="profile-api-token-create">
          {t('apiToken.create.action')}
        </Button>
      </div>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('account.apiToken.hint')}</p>
      {tokens.isError ? (
        <QueryError error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : (
        <ApiTokenTable
          tokens={tokens.data?.items}
          loading={tokens.isPending}
          canRevoke
          onRevoke={(token) => revoke.mutateAsync({ params: { tokenId: token.id } })}
          data-testid="profile-api-token-table"
        />
      )}
      <ApiTokenCreateDialog
        open={creating}
        onOpenChange={setCreating}
        maxDays={PERSONAL_TOKEN_MAX_DAYS}
        scopeOptions={scopeOptions}
        onCreate={(body) => create.mutateAsync({ params: body })}
      />
    </section>
  );
}
