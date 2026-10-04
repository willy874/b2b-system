import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant, TenantFeatureParam } from '@/shared/api-sdk';

import {
  TENANT_FEATURE_PARAM_DESCRIPTION_KEY,
  TENANT_FEATURE_PARAM_LABEL_KEY,
} from '../../../constants';
import { useUpdateTenantFeatureParamsMutation } from '../../../hooks/useTenantMutations';
import { formatParamValue } from '../../../utils';

interface TenantFeatureParamDialogProps {
  tenant: PlatformTenant;
  /** 編輯中的參數；`undefined` 時對話框關閉。 */
  param: TenantFeatureParam | undefined;
  onClose: () => void;
}

/**
 * 改一個 feature 參數（docs/architecture/05-tenancy.md §13.2 D3）：整數檢查範圍、字串檢查長度，
 * 伺服器另外驗證；「恢復預設」送 `null`（不再覆寫）。
 */
export function TenantFeatureParamDialog({
  tenant,
  param,
  onClose,
}: TenantFeatureParamDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const update = useUpdateTenantFeatureParamsMutation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string>();
  // 打開另一個參數時以它的目前值重設表單
  if (param?.key !== editing) {
    setEditing(param?.key);
    setDraft(param ? String(param.value) : '');
    setError(undefined);
  }
  if (!param) return null;

  const isInteger = param.type === 'integer';
  const resetting = update.variables?.params.body.featureParams?.[param.key] === null;
  const label = t(TENANT_FEATURE_PARAM_LABEL_KEY[param.key]);

  const save = async (value: number | string | null) => {
    try {
      await update.mutateAsync({
        params: { id: tenant.id, body: { featureParams: { [param.key]: value } } },
      });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  const submit = () => {
    if (!isInteger) {
      void save(draft);
      return;
    }
    const value = Number(draft);
    const min = param.min ?? Number.MIN_SAFE_INTEGER;
    const max = param.max ?? Number.MAX_SAFE_INTEGER;
    if (!draft.trim() || !Number.isInteger(value) || value < min || value > max) {
      setError(t('tenant.param.rangeError', { min, max }));
      return;
    }
    void save(value);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('tenant.param.editTitle', { name: label })}
      description={t(TENANT_FEATURE_PARAM_DESCRIPTION_KEY[param.key])}
      data-testid="tenant-param-dialog"
      footer={
        <>
          {param.overridden && (
            <Button
              loading={update.isPending && resetting}
              disabled={update.isPending && !resetting}
              onClick={() => void save(null)}
              data-testid="tenant-param-reset"
            >
              {t('tenant.param.reset')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={update.isPending && !resetting}
            disabled={update.isPending && resetting}
            onClick={submit}
            data-testid="tenant-param-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          label={label}
          required
          error={error}
          description={
            isInteger
              ? t('tenant.param.rangeHint', {
                  min: param.min,
                  max: param.max,
                  default: formatParamValue(t, param, param.defaultValue),
                })
              : t('tenant.param.defaultHint', {
                  default: formatParamValue(t, param, param.defaultValue),
                })
          }
        >
          <Input
            type={isInteger ? 'number' : 'text'}
            inputMode={isInteger ? 'numeric' : undefined}
            min={param.min ?? undefined}
            max={param.max ?? undefined}
            maxLength={param.maxLength ?? undefined}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="tenant-param-input"
          />
        </Field>
      </form>
    </Dialog>
  );
}
