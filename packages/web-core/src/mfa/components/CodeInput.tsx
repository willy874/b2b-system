import { Input } from '@b2b-system/ui/Input';
import type { Ref } from 'react';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 幾位數；預設 6（TOTP、Email 驗證碼）。 */
  digits?: number;
  disabled?: boolean;
  ref?: Ref<HTMLInputElement>;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * 驗證碼的輸入框：只留數字、`autocomplete="one-time-code"`（手機可以從簡訊或通知帶入）、數字鍵盤。
 * 貼上 `123 456` 之類有空白的碼也接受。
 */
export function CodeInput({ value, onChange, digits = 6, ...rest }: CodeInputProps) {
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern={`\\d{${digits}}`}
      maxLength={digits}
      className="font-mono tracking-[0.3em]"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, digits))}
    />
  );
}
