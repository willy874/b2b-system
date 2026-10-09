import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isAppError, useErrorMessage, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getClearMfaMethodSettingsMutationOptions } from '@/apis/platform-mfa-method/clear-mfa-method-settings/mutation';
import { MFA_METHOD_LIST_QUERY_KEY } from '@/apis/platform-mfa-method/get-mfa-method-list/query';
import {
  getMfaMethodSettingsQueryOptions,
  MFA_METHOD_SETTINGS_QUERY_KEY,
} from '@/apis/platform-mfa-method/get-mfa-method-settings/query';
import { getSaveMfaMethodSettingsMutationOptions } from '@/apis/platform-mfa-method/save-mfa-method-settings/mutation';
import type { MfaMethodSettings, MfaSettingField, PlatformMfaMethod } from '@/shared/api-sdk';

type Values = Record<string, string>;

/** 欄位在目前的值之下是否顯示：有 `requiredWhen` 的欄位只在條件成立時出現（例：選了 Twilio 才顯示 Twilio 的欄位）。 */
export function isFieldVisible(field: MfaSettingField, values: Values): boolean {
  return !field.requiredWhen || values[field.requiredWhen.key] === field.requiredWhen.equals;
}

function initialValues(fields: readonly MfaSettingField[], settings: MfaMethodSettings): Values {
  const values: Values = {};
  for (const field of fields) {
    if (field.type === 'secret') continue;
    values[field.key] =
      settings.values[field.key] ?? (settings.version === null ? (field.defaultValue ?? '') : '');
  }
  return values;
}

/**
 * 驗證方式的平台參數（docs/architecture/backend/21-mfa.md §5.1）：依方式定義的欄位產生表單。
 * 機密欄位不回傳值：留空 = 沿用已儲存的值。儲存時伺服器會以金鑰呼叫供應商確認可用，檢查不通過的欄位顯示在欄位下方。
 * **參數填齊之前，方式不能開啟**（全平台與租戶層都一樣）。
 */
export function MfaMethodSettingsDialog({
  method,
  label,
  canUpdate,
  onClose,
}: {
  method: PlatformMfaMethod;
  label: string;
  canUpdate: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const settings = useQuery(getMfaMethodSettingsQueryOptions(method.id));
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('mfaMethod.settings.title', { name: label })}
      description={t('mfaMethod.settings.description')}
      size="lg"
      data-testid="mfa-method-settings-dialog"
    >
      {settings.isPending ? (
        <Skeleton className="h-40" />
      ) : settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm
          method={method}
          settings={settings.data}
          canUpdate={canUpdate}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function SettingsForm({
  method,
  settings,
  canUpdate,
  onClose,
}: {
  method: PlatformMfaMethod;
  settings: MfaMethodSettings;
  canUpdate: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const fields = method.settings?.fields ?? [];
  const [values, setValues] = useState<Values>(() => initialValues(fields, settings));
  const [secrets, setSecrets] = useState<Values>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ code?: string; message: string }>();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [MFA_METHOD_LIST_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [MFA_METHOD_SETTINGS_QUERY_KEY, method.id] }),
    ]);

  const save = useMutation({
    ...getSaveMfaMethodSettingsMutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t('mfaMethod.settings.saved'));
      onClose();
    },
    onError: (error) => {
      const fieldsOf = isAppError(error) ? (error.fieldErrors ?? {}) : {};
      setFieldErrors(fieldsOf);
      const reason = isAppError(error) ? error.details?.reason : undefined;
      setFormError({
        code: isAppError(error) ? error.code : undefined,
        message: typeof reason === 'string' ? t(`mfa.settings.error.${reason}`) : toMessage(error),
      });
    },
  });
  const clear = useMutation({
    ...getClearMfaMethodSettingsMutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t('mfaMethod.settings.cleared'));
      onClose();
    },
  });

  const visible = fields.filter((field) => isFieldVisible(field, values));

  const submit = () => {
    setFieldErrors({});
    setFormError(undefined);
    // 不顯示的欄位不送出：換了供應商之後，舊供應商的值不留在參數裡
    const visibleKeys = new Set(visible.map((field) => field.key));
    const plain = Object.fromEntries(
      Object.entries(values).filter(([key]) => visibleKeys.has(key)),
    );
    const secretValues = Object.fromEntries(
      fields
        .filter((field) => field.type === 'secret')
        .flatMap((field): Array<[string, string]> => {
          if (!visibleKeys.has(field.key))
            return settings.secrets[field.key] ? [[field.key, '']] : [];
          const given = secrets[field.key];
          return given ? [[field.key, given]] : [];
        }),
    );
    save.mutate({
      params: { id: method.id, values: plain, secrets: secretValues, version: settings.version },
    });
  };

  const remove = () =>
    void confirm({
      title: t('mfaMethod.settings.clearTitle'),
      description: t('mfaMethod.settings.clearDescription'),
      confirmLabel: t('mfaMethod.settings.clear'),
      tone: 'danger',
      onConfirm: () =>
        clear.mutateAsync({ params: { id: method.id } }).catch((caught: unknown) => {
          showError(caught);
          throw caught;
        }),
      'data-testid': 'mfa-method-settings-clear-dialog',
    });

  const textOf = (field: MfaSettingField, part: 'label' | 'description') =>
    t(`mfa.method.${method.id}.settings.${field.key}.${part}`);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      data-testid="mfa-method-settings-form"
    >
      {visible.map((field) => {
        const error = fieldErrors[field.key];
        const required = field.required && (!field.requiredWhen || isFieldVisible(field, values));
        const common = {
          label: textOf(field, 'label'),
          description: textOf(field, 'description'),
          required: required && !(field.type === 'secret' && settings.secrets[field.key]),
          error: error && t(`mfa.settings.error.${error}`),
          errorCode: error,
        };
        if (field.type === 'select') {
          return (
            <Field key={field.key} {...common} data-testid={`mfa-setting-field-${field.key}`}>
              <Select
                value={values[field.key] ?? ''}
                disabled={!canUpdate}
                onValueChange={(value) =>
                  setValues((current) => ({ ...current, [field.key]: value }))
                }
                options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
                aria-label={common.label}
                data-testid={`mfa-setting-${field.key}`}
              />
            </Field>
          );
        }
        if (field.type === 'secret') {
          return (
            <Field key={field.key} {...common} data-testid={`mfa-setting-field-${field.key}`}>
              <Input
                type="password"
                autoComplete="off"
                disabled={!canUpdate}
                value={secrets[field.key] ?? ''}
                placeholder={
                  settings.secrets[field.key] ? t('mfaMethod.settings.secretKept') : undefined
                }
                maxLength={field.maxLength}
                onChange={(event) =>
                  setSecrets((current) => ({ ...current, [field.key]: event.target.value }))
                }
                data-testid={`mfa-setting-${field.key}`}
              />
            </Field>
          );
        }
        return (
          <Field key={field.key} {...common} data-testid={`mfa-setting-field-${field.key}`}>
            <Input
              type={field.type === 'url' ? 'url' : 'text'}
              disabled={!canUpdate}
              value={values[field.key] ?? ''}
              maxLength={field.maxLength}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              data-testid={`mfa-setting-${field.key}`}
            />
          </Field>
        );
      })}
      <FormError code={formError?.code} data-testid="mfa-method-settings-error">
        {formError?.message}
      </FormError>
      <div className="flex flex-wrap justify-between gap-2">
        {canUpdate && settings.version !== null ? (
          <Button variant="danger" onClick={remove} data-testid="mfa-method-settings-clear">
            {t('mfaMethod.settings.clear')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose} data-testid="mfa-method-settings-cancel">
            {t('common.cancel')}
          </Button>
          {canUpdate && (
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              data-testid="mfa-method-settings-save"
            >
              {t('mfaMethod.settings.save')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
