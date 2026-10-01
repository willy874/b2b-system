import { useCallback, useMemo, useState } from 'react';

import type { UpdateNotificationEventsRequest } from '@/shared/api-sdk';

import type { NotificationChannel, NotificationEventView } from '../types';

type Change = UpdateNotificationEventsRequest['changes'][number];

/** 草稿的 key：事件 ＋ 管道（只在本檔使用）。 */
function draftKey(type: string, channel: NotificationChannel): string {
  return `${type} ${channel}`;
}

function serverOf(event: NotificationEventView, channel: NotificationChannel) {
  return event.channels.find((item) => item.channel === channel);
}

/**
 * 事件管理頁的編輯草稿：只記「和伺服器不同」的欄位，送出時轉成 `PATCH /notification-events` 的 `changes`。
 * 每個「事件 ＋ 管道」有兩個欄位：`enabled`（`null` 代表還原預設，有覆寫而切回預設值也是）與 `allowUserOverride`；
 * 改回伺服器上的值時那一欄從草稿移除，兩欄都沒有時整筆移除。
 */
export function useNotificationEventDraft() {
  const [draft, setDraft] = useState<ReadonlyMap<string, Change>>(new Map());

  /** 改一筆的某一欄；值為 `undefined` 是移除那一欄。 */
  const patch = useCallback(
    (
      event: NotificationEventView,
      channel: NotificationChannel,
      fields: Pick<Change, 'enabled' | 'allowUserOverride'>,
    ) => {
      setDraft((prev) => {
        const key = draftKey(event.type, channel);
        const merged: Change = { ...prev.get(key), type: event.type, channel, ...fields };
        if (merged.enabled === undefined) delete merged.enabled;
        if (merged.allowUserOverride === undefined) delete merged.allowUserOverride;
        const next = new Map(prev);
        if (merged.enabled === undefined && merged.allowUserOverride === undefined)
          next.delete(key);
        else next.set(key, merged);
        return next;
      });
    },
    [],
  );

  const setEnabled = useCallback(
    (event: NotificationEventView, channel: NotificationChannel, enabled: boolean) => {
      const server = serverOf(event, channel);
      if (!server) return;
      if (enabled === server.enabled) return patch(event, channel, { enabled: undefined });
      // 有覆寫而切回預設值：送「還原預設」，不留一筆與預設相同的覆寫
      const isBackToDefault = server.isOverridden && enabled === server.defaultEnabled;
      patch(event, channel, { enabled: isBackToDefault ? null : enabled });
    },
    [patch],
  );

  const setAllowUserOverride = useCallback(
    (event: NotificationEventView, channel: NotificationChannel, allow: boolean) => {
      const server = serverOf(event, channel);
      if (!server) return;
      patch(event, channel, {
        allowUserOverride: allow === server.allowUserOverride ? undefined : allow,
      });
    },
    [patch],
  );

  const resetToDefault = useCallback(
    (event: NotificationEventView, channel: NotificationChannel) => {
      const server = serverOf(event, channel);
      if (!server) return;
      patch(event, channel, { enabled: server.isOverridden ? null : undefined });
    },
    [patch],
  );

  const clear = useCallback(() => setDraft(new Map()), []);

  /** 畫面上要顯示的值（套用草稿之後）。 */
  const current = useCallback(
    (
      event: NotificationEventView,
      channel: NotificationChannel,
    ): { enabled: boolean; isOverridden: boolean; allowUserOverride: boolean } => {
      const server = serverOf(event, channel);
      if (!server) return { enabled: false, isOverridden: false, allowUserOverride: false };
      const change = draft.get(draftKey(event.type, channel));
      const allowUserOverride = change?.allowUserOverride ?? server.allowUserOverride;
      if (change?.enabled === undefined) {
        return { enabled: server.enabled, isOverridden: server.isOverridden, allowUserOverride };
      }
      return change.enabled === null
        ? { enabled: server.defaultEnabled, isOverridden: false, allowUserOverride }
        : { enabled: change.enabled, isOverridden: true, allowUserOverride };
    },
    [draft],
  );

  const changes = useMemo(() => [...draft.values()], [draft]);

  return {
    changes,
    isDirty: changes.length > 0,
    current,
    setEnabled,
    setAllowUserOverride,
    resetToDefault,
    clear,
  };
}
