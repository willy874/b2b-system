import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import { ApiTokenTable } from '@/core/components';

import { useUserApiTokens } from '../../../hooks/useUserApiTokens';

interface UserApiTokenSectionProps {
  userId: string;
}

/**
 * 這位使用者的個人 API token：管理者可以撤銷（例：人員異動、token 外流），不能替別人建立
 * （docs/architecture/06-external-api.md §9.2 D14）。
 */
export function UserApiTokenSection({ userId }: UserApiTokenSectionProps) {
  const { t } = useTranslation();
  const { tokens, revoke } = useUserApiTokens(userId);

  return (
    <section className="flex flex-col gap-2" data-testid="user-api-tokens">
      <h3 className="m-0 text-sm font-semibold">{t('user.detail.apiTokens')}</h3>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('user.detail.apiTokensHint')}</p>
      {tokens.isError ? (
        <QueryError error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : (
        <ApiTokenTable
          tokens={tokens.data?.items}
          loading={tokens.isPending}
          canRevoke
          onRevoke={(token) => revoke.mutateAsync({ params: { userId, tokenId: token.id } })}
          data-testid="user-api-token-table"
        />
      )}
    </section>
  );
}
