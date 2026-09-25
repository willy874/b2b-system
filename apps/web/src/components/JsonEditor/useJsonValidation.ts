import { useDeferredValue, useEffect, useState } from 'react';

import type { JsonValidationError, JsonValidator } from './validation';

const NO_ERRORS: readonly JsonValidationError[] = [];

/**
 * 值改變時重新驗證。以 `useDeferredValue` 延後，連續打字時不會每個字都卡住輸入；
 * 非同步的 validator 回來時值已經又變了，就丟掉舊結果。validator 本身失敗（例如 schema 不合法）時回報成根節點的錯誤。
 */
export function useJsonValidation(
  value: unknown,
  validator: JsonValidator | undefined,
): readonly JsonValidationError[] {
  const deferred = useDeferredValue(value);
  const [errors, setErrors] = useState(NO_ERRORS);

  useEffect(() => {
    if (!validator) return;
    let isCurrent = true;
    Promise.resolve()
      .then(() => validator(deferred))
      .then(
        (result) => {
          if (isCurrent) setErrors(result.length === 0 ? NO_ERRORS : result);
        },
        (error: unknown) => {
          if (!isCurrent) return;
          setErrors([
            {
              path: [],
              message: error instanceof Error ? error.message : String(error),
              keyword: 'validator',
              params: {},
            },
          ]);
        },
      );
    return () => {
      isCurrent = false;
    };
  }, [deferred, validator]);

  return validator ? errors : NO_ERRORS;
}
