import { useCallback, useMemo, useState } from 'react';

import type { UpdateNotificationEventsRequest } from '@/shared/api-sdk';

import type { NotificationChannel, NotificationEventView } from '../types';

type Change = UpdateNotificationEventsRequest['changes'][number];

/** 草稿的 key：事件 ＋ 管道（只在本檔使用）。 */
function draftKey(type: string, channel: NotificationChannel): string {
  return `${type} ${channel}`;
}

/**
 * 事件管理頁的編輯草稿：只記「和伺服器不同」的開關，送出時轉成 `PATCH /notification-events` 的 `changes`。
 * `enabled: null` 代表還原預設（有覆寫而切回預設值也是）；改回伺服器上的值或還原一個沒有覆寫的開關時，那一筆從草稿移除。
 */
export function useNotificationEventDraft() {
  const [draft, setDraft] = useState<ReadonlyMap<string, Change>>(new Map());

  const update = useCallback((key: string, change: Change | undefined) => {
    setDraft((prev) => {
      const next = new Map(prev);
      if (change) next.set(key, change);
      else next.delete(key);
      return next;
    });
  }, []);

  const setEnabled = useCallback(
    (event: NotificationEventView, channel: NotificationChannel, enabled: boolean) => {
      const server = event.channels.find((item) => item.channel === channel);
      if (!server) return;
      const key = draftKey(event.type, channel);
      if (enabled === server.enabled) return update(key, undefined);
      // 有覆寫而切回預設值：送「還原預設」，不留一筆與預設相同的覆寫
      const isBackToDefault = server.isOverridden && enabled === server.defaultEnabled;
      update(key, { type: event.type, channel, enabled: isBackToDefault ? null : enabled });
    },
    [update],
  );

  const resetToDefault = useCallback(
    (event: NotificationEventView, channel: NotificationChannel) => {
      const server = event.channels.find((item) => item.channel === channel);
      if (!server) return;
      const key = draftKey(event.type, channel);
      update(key, server.isOverridden ? { type: event.type, channel, enabled: null } : undefined);
    },
    [update],
  );

  const clear = useCallback(() => setDraft(new Map()), []);

  /** 畫面上要顯示的值與是否覆寫（套用草稿之後）。 */
  const current = useCallback(
    (
      event: NotificationEventView,
      channel: NotificationChannel,
    ): { enabled: boolean; isOverridden: boolean } => {
      const server = event.channels.find((item) => item.channel === channel);
      const change = draft.get(draftKey(event.type, channel));
      if (!server) return { enabled: false, isOverridden: false };
      if (!change) return { enabled: server.enabled, isOverridden: server.isOverridden };
      return change.enabled === null
        ? { enabled: server.defaultEnabled, isOverridden: false }
        : { enabled: change.enabled, isOverridden: true };
    },
    [draft],
  );

  const changes = useMemo(() => [...draft.values()], [draft]);

  return {
    changes,
    isDirty: changes.length > 0,
    current,
    setEnabled,
    resetToDefault,
    clear,
  };
}
