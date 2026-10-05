import type { ReactNode } from 'react';

import { usePermission } from '../../permission';
import type { PermissionKey } from '../../permission';

export interface PermissionGateProps {
  require: PermissionKey[];
  match?: 'every' | 'some';
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * 宣告式 gating，供巢狀較深的地方使用。
 * 能用 `&&` 的地方就用 `&&`，這個留給「多個權限 ＋ 需要 fallback」的場合。
 */
export function PermissionGate({
  require,
  match = 'every',
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hydrated, canEvery, canSome } = usePermission();
  if (!hydrated) return fallback;
  const granted = match === 'every' ? canEvery(require) : canSome(require);
  return granted ? children : fallback;
}
