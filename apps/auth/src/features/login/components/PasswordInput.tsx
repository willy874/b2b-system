import { useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Input } from '@/components/Input';
import type { InputProps } from '@/components/Input';
import { useTranslation } from '@/core/locales';

type PasswordInputProps = Omit<InputProps, 'type'>;

/**
 * 登入用的密碼欄（UX-33）：可以切換顯示／隱藏，開著 Caps Lock 輸入時提示。
 * 切換鈕是一般的 `<button type="button">`，鍵盤可操作，不會送出表單。
 */
export function PasswordInput({ onKeyDown, onKeyUp, onBlur, ...rest }: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const detectCapsLock = (event: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState('CapsLock'));
  const toggleText = visible ? t('login.password.hide') : t('login.password.show');
  const toggleLabel = visible ? t('login.password.hideLabel') : t('login.password.showLabel');

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Input
          {...rest}
          type={visible ? 'text' : 'password'}
          className="w-full pr-16"
          onKeyDown={(event) => {
            detectCapsLock(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            detectCapsLock(event);
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
        />
        <button
          type="button"
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--color-brand)]"
          aria-pressed={visible}
          aria-label={toggleLabel}
          onClick={() => setVisible((value) => !value)}
          data-testid="password-visibility-toggle"
        >
          {toggleText}
        </button>
      </div>
      {capsLock && (
        <output className="text-xs text-[var(--color-warning-text)]" data-testid="caps-lock-hint">
          {t('login.password.capsLock')}
        </output>
      )}
    </div>
  );
}
