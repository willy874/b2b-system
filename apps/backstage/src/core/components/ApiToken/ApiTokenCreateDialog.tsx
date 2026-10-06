import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { Text } from '@b2b-system/ui/Typography';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useId, useState } from 'react';

import type { CreateApiTokenRequest, CreatedApiToken, PermissionKey } from '@/shared/api-sdk';

import { API_TOKEN_LIFETIME_OPTIONS } from './constants';

export interface ApiTokenCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 到期天數的上限（個人 90、服務帳號 365）；租戶設定更短時由後端回 `API_TOKEN_LIFETIME_EXCEEDED`。 */
  maxDays: number;
  /**
   * 可以限縮到的權限鍵與它們的名稱（呼叫端以操作者持有的權限算出）；不帶就不提供限縮，token 跟著帳號。
   */
  scopeOptions?: ReadonlyArray<{ key: PermissionKey; label: string }>;
  /** 送出；成功回傳含完整 token 的結果，失敗丟錯（訊息顯示在對話框裡）。 */
  onCreate: (request: CreateApiTokenRequest) => Promise<CreatedApiToken>;
  'data-testid'?: string;
}

/**
 * 建立 API token（docs/architecture/06-external-api.md §9.2 D7、D8）：名稱、有效天數、（選用）限縮權限。
 * 建立成功後同一個對話框改成顯示完整的 token——**只出現這一次**，關掉之後再也看不到。
 */
export function ApiTokenCreateDialog({
  open,
  onOpenChange,
  maxDays,
  scopeOptions,
  onCreate,
  'data-testid': testId = 'api-token-create-dialog',
}: ApiTokenCreateDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const formId = useId();
  const [name, setName] = useState('');
  const [days, setDays] = useState(String(Math.min(30, maxDays)));
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken>();

  const lifetimeOptions: SelectOption[] = API_TOKEN_LIFETIME_OPTIONS.filter(
    (option) => option <= maxDays,
  ).map((option) => ({ value: String(option), label: t('apiToken.lifetime', { count: option }) }));

  const reset = () => {
    setName('');
    setDays(String(Math.min(30, maxDays)));
    setScopes([]);
    setError(undefined);
    setCreated(undefined);
  };

  const changeOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    setError(undefined);
    setSubmitting(true);
    // 選項就是權限鍵：以選項換回型別，不轉型
    const selected = (scopeOptions ?? [])
      .filter((option) => scopes.includes(option.key))
      .map((option) => option.key);
    try {
      setCreated(
        await onCreate({
          name: name.trim(),
          expiresInDays: Number(days),
          ...(selected.length ? { scopes: selected } : {}),
        }),
      );
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      // 完整的 token 只出現這一次：顯示中 Esc、點遮罩不關閉，只能按「我已保存」
      dismissible={!created}
      title={created ? t('apiToken.created.title') : t('apiToken.create.title')}
      description={created ? undefined : t('apiToken.create.description')}
      size="md"
      data-testid={testId}
      footer={
        created ? (
          <Button variant="primary" onClick={() => changeOpen(false)} data-testid="api-token-done">
            {t('apiToken.created.done')}
          </Button>
        ) : (
          <>
            <Button onClick={() => changeOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={!name.trim()}
              loading={submitting}
              data-testid="api-token-create-submit"
            >
              {t('common.create')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3" data-testid="api-token-created">
          {/* role="alert"：報讀器立即念出「只會顯示這一次」 */}
          <p role="alert" className="m-0 text-sm text-[var(--color-warning-text)]">
            {t('apiToken.created.warning')}
          </p>
          <Text
            code
            className="break-all"
            copyable={{ text: created.token }}
            data-testid="api-token-value"
          >
            {created.token}
          </Text>
        </div>
      ) : (
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            label={t('apiToken.field.name')}
            description={t('apiToken.create.nameHint')}
            required
          >
            <Input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              data-testid="api-token-name-input"
            />
          </Field>
          <Field label={t('apiToken.field.expiresAt')} required>
            <Select
              value={days}
              onValueChange={setDays}
              options={lifetimeOptions}
              aria-label={t('apiToken.field.expiresAt')}
              data-testid="api-token-lifetime-select"
            />
          </Field>
          {scopeOptions && (
            <Field label={t('apiToken.field.scopes')} description={t('apiToken.create.scopesHint')}>
              <Select
                multiple
                searchable
                value={scopes}
                onValueChange={setScopes}
                options={scopeOptions.map(({ key, label }) => ({
                  value: key,
                  label,
                  textValue: `${label} ${key}`,
                  description: key,
                }))}
                itemSize={48}
                placeholder={t('apiToken.scopes.all')}
                searchPlaceholder={t('common.search')}
                aria-label={t('apiToken.field.scopes')}
                data-testid="api-token-scopes-select"
              />
            </Field>
          )}
          <p role="alert" className="m-0 text-sm text-[var(--color-danger-text)] empty:hidden">
            {error}
          </p>
        </form>
      )}
    </Dialog>
  );
}
