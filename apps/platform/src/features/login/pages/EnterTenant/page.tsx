import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { EnterTenantRoute } from '../../routes';
import { goToTenantLogin } from '../../tenant';
import { AuthShell } from '../AuthShell';

/**
 * 進入租戶（docs/architecture/05-tenancy.md §10.2 D11）：輸入租戶代碼，前往那個租戶的 backstage 登入。
 * apps/platform 不列出一個人屬於哪些租戶（帳號分散在各租戶的 DB）；網址帶 `?tenant=` 時直接前往。
 */
export default function EnterTenantPage() {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const { tenant } = EnterTenantRoute.useSearch();
  const [code, setCode] = useState(tenant ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const enter = async (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      setError(t('login.enterTenant.required'));
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      // 成功時整頁跳走，不必把 pending 改回來
      await goToTenantLogin(normalized);
    } catch (caught) {
      setError(toMessage(caught));
      setPending(false);
    }
  };

  // 網址帶了代碼：直接前往（帳號流程完成、或別的頁面帶過來的）
  useEffect(() => {
    if (!tenant) return;
    goToTenantLogin(tenant.trim().toLowerCase()).catch((caught: unknown) =>
      setError(toMessage(caught)),
    );
  }, [tenant, toMessage]);

  return (
    <AuthShell
      title={t('login.enterTenant.title')}
      description={t('login.enterTenant.description')}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void enter(code);
        }}
      >
        <Field label={t('login.enterTenant.code')} required error={error}>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={63}
            autoComplete="organization"
            data-testid="enter-tenant-code"
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          block
          loading={pending}
          data-testid="enter-tenant-submit"
        >
          {t('login.enterTenant.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
