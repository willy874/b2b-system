import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { FormError } from './index';

describe('FormError（表單層級的錯誤）', () => {
  it('以 role="alert" 呈現訊息，錯誤碼放在 data-value', () => {
    render(
      <FormError code="AUTH_INVALID_CREDENTIALS" data-testid="login-error">
        帳號或密碼錯誤
      </FormError>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('帳號或密碼錯誤');
    expect(alert).toHaveAttribute('data-value', 'AUTH_INVALID_CREDENTIALS');
    expect(alert).toHaveAttribute('data-testid', 'login-error');
  });

  it('沒有訊息時元素仍在（內容改變時報讀器才確定會念）', () => {
    const { rerender } = render(<FormError />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeEmptyDOMElement();
    rerender(<FormError>送出失敗</FormError>);
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent('送出失敗');
  });

  it('透傳 ref 與 className', () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<FormError ref={ref} className="mt-2" />);
    expect(ref.current).toBe(screen.getByRole('alert'));
    expect(ref.current).toHaveClass('mt-2');
  });
});
