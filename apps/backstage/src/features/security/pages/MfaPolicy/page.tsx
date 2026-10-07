import { Button } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Chip } from '@b2b-system/ui/Chip';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Select } from '@b2b-system/ui/Select';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { Switch } from '@b2b-system/ui/Switch';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMfaMethodUis } from '@b2b-system/web-core/mfa';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';

import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { usePagePermission } from '@/core/permission';
import { SystemSettingsLayout } from '@/core/system-settings';

import { useMfaPolicyForm } from '../../hooks/useMfaPolicyForm';
import { SECURITY_MFA_PAGE } from '../../permission';

/**
 * 租戶的 MFA 政策（docs/architecture/backend/21-mfa.md §6）：允許的方式、全員必須、指定角色必須。
 * 收緊立即生效但不踢人：已登入的人下一次登入才被要求設定。沒有 `mfaPolicy:update` 時唯讀。
 * 是系統設定的「安全性」分頁（docs/architecture/frontend/02-plugin-system.md §4.5）。
 */
export default function MfaPolicyPage() {
  return (
    <SystemSettingsLayout>
      <MfaPolicyForm />
    </SystemSettingsLayout>
  );
}

function MfaPolicyForm() {
  const { t } = useTranslation();
  const permission = usePagePermission(SECURITY_MFA_PAGE);
  const canUpdate = permission.hydrated && permission.canUpdate;
  const form = useMfaPolicyForm();
  const uis = useMfaMethodUis();
  const roles = useQuery({
    ...getRoleOptionsQueryOptions(),
    enabled: canUpdate || Boolean(form.current?.requiredRoleIds.length),
  });
  useUnsavedChangesGuard(form.dirty);

  if (form.policy.isPending) return <Skeleton className="h-60" />;
  if (form.policy.isError || !form.policy.data || !form.current) {
    return <QueryError error={form.policy.error} onRetry={() => void form.policy.refetch()} />;
  }
  const policy = form.policy.data;
  const { current } = form;
  const enabled = policy.methods.filter((method) => method.platformEnabled);
  const allowAll = current.allowedMethods === null;
  const isAllowed = (id: string) => allowAll || (current.allowedMethods ?? []).includes(id);

  return (
    <form
      className="flex max-w-3xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (canUpdate && form.dirty) void form.save();
      }}
      data-testid="security-mfa-page"
    >
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('security.mfa.description')}</p>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-base font-medium">{t('security.mfa.methods')}</h2>
        <Checkbox
          checked={allowAll}
          disabled={!canUpdate}
          onCheckedChange={(checked) =>
            form.change({
              allowedMethods: checked ? null : enabled.map((method) => method.id),
            })
          }
          label={t('security.mfa.allowAll')}
          description={t('security.mfa.allowAllHint')}
          data-testid="security-mfa-allow-all"
        />
        <div className="ml-6 flex flex-col gap-2">
          {policy.methods.map((method) => {
            const ui = uis.get(method.id);
            return (
              <Checkbox
                key={method.id}
                checked={method.platformEnabled && isAllowed(method.id)}
                disabled={!canUpdate || allowAll || !method.platformEnabled}
                onCheckedChange={(checked) => {
                  const next = new Set(current.allowedMethods ?? []);
                  if (checked) next.add(method.id);
                  else next.delete(method.id);
                  form.change({
                    allowedMethods: policy.methods.map((m) => m.id).filter((id) => next.has(id)),
                  });
                }}
                label={
                  <span className="flex items-center gap-2">
                    {ui ? t(ui.labelKey) : method.id}
                    {method.assurance === 'inbox' && (
                      <Chip tone="warning">{t('security.mfa.inboxAssurance')}</Chip>
                    )}
                    {!method.platformEnabled && <Chip>{t('security.mfa.platformDisabled')}</Chip>}
                  </span>
                }
                data-testid="security-mfa-method"
              />
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-base font-medium">{t('security.mfa.required')}</h2>
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={current.requireAll}
            disabled={!canUpdate}
            onCheckedChange={(requireAll) => form.change({ requireAll })}
            aria-label={t('security.mfa.requireAll')}
            data-testid="security-mfa-require-all"
          />
          {t('security.mfa.requireAll')}
        </label>
        <Field
          label={t('security.mfa.requiredRoles')}
          description={t('security.mfa.requiredRolesHint')}
        >
          <Select
            multiple
            searchable
            valueOrder="options"
            disabled={!canUpdate || current.requireAll}
            value={current.requiredRoleIds}
            onValueChange={(requiredRoleIds: string[]) => form.change({ requiredRoleIds })}
            options={(roles.data?.items ?? []).map((role) => ({
              value: role.id,
              label: role.name,
            }))}
            data-testid="security-mfa-required-roles"
          />
        </Field>
        <p
          className="m-0 text-sm"
          data-testid="security-mfa-non-compliant"
          data-value={policy.nonCompliant}
        >
          {t('security.mfa.nonCompliant', { count: policy.nonCompliant })}{' '}
          {policy.nonCompliant > 0 && (
            <RouteLink
              to="user.listByMfa"
              params={{ mfa: 'false' }}
              className="text-[var(--color-brand)]"
            >
              {t('security.mfa.viewUsers')}
            </RouteLink>
          )}
        </p>
      </section>

      <FormError code={form.error?.code} data-testid="security-mfa-error">
        {form.error?.message}
      </FormError>
      {canUpdate && (
        <div className="flex justify-end gap-2">
          <Button disabled={!form.dirty} onClick={form.reset} data-testid="security-mfa-reset">
            {t('common.reset')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={form.saving}
            disabled={!form.dirty}
            data-testid="security-mfa-save"
          >
            {t('common.save')}
          </Button>
        </div>
      )}
    </form>
  );
}
