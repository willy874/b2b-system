import { useEffect } from 'react';

import { setTelemetryUser } from './telemetry';

/**
 * 錯誤回報帶上目前登入者的 id（只有 id，docs/architecture/frontend/19-observability.md §9.2 D7）；登出後 profile 沒了就清掉。
 * 掛在 app 的 profile 同步處（`app/App.tsx` 的 `ProfileSync`）。
 */
export function useTelemetryUser(id: string | undefined): void {
  useEffect(() => {
    setTelemetryUser(id);
  }, [id]);
}
