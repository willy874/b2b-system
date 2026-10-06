import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';

import { ServiceAccountRoleSelect } from '../../components/ServiceAccountRoleSelect';
import { useServiceAccountCreateMutation } from '../../hooks/useServiceAccountMutations';
import { useServiceAccountPermission } from '../../hooks/useServiceAccountPermission';
import {
  ServiceAccountCreateRoute,
  ServiceAccountDetailRoute,
  ServiceAccountListRoute,
} from '../../routes';

/** 建立服務帳號：名稱與持有的角色（受反提權限制，後端檢查）。token 在建立後的詳情頁建立。 */
export default function ServiceAccountCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = ServiceAccountCreateRoute.useSearch();
  const permission = useServiceAccountPermission();
  const createAccount = useServiceAccountCreateMutation();
  const toMessage = useErrorMessage();
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: permission.canReadRoles });
  const formId = useId();
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string>();
  useUnsavedChangesGuard(Boolean(name) || roleIds.length > 0);

  const close = () => void navigate({ to: ServiceAccountListRoute.to, search });

  const submit = async () => {
    setFormError(undefined);
    try {
      const account = await createAccount.mutateAsync({ params: { name: name.trim(), roleIds } });
      // 建立之後直接進詳情建 token
      void navigate({
        to: ServiceAccountDetailRoute.to,
        params: { serviceAccountId: account.id },
        search,
        ignoreBlocker: true,
      });
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('serviceAccount.create.title')}
      description={t('serviceAccount.create.description')}
      size="md"
      data-testid="service-account-create-dialog"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={!name.trim()}
            loading={createAccount.isPending}
            data-testid="service-account-create-submit"
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('serviceAccount.field.name')} required>
          <Input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            data-testid="service-account-name-input"
          />
        </Field>
        {permission.canReadRoles && (
          <Field
            label={t('serviceAccount.field.roles')}
            description={t('serviceAccount.role.hint')}
          >
            <ServiceAccountRoleSelect
              roles={roles.data?.items}
              value={roleIds}
              onValueChange={setRoleIds}
              aria-label={t('serviceAccount.field.roles')}
              data-testid="service-account-role-select"
            />
          </Field>
        )}
        <FormError>{formError}</FormError>
      </form>
    </Dialog>
  );
}
