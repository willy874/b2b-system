-- 「兩欄都是預設的列不該存在」改由 service 判斷（docs/architecture/backend/16-notification-event.md §2）：
-- `allow_user_override` 的預設值依事件而定（announcement.published 預設 false，docs/architecture/backend/19-announcement.md §9 D16），
-- 約束寫死「預設是 true」會擋下合法的覆寫（enabled 跟著預設、允許個人調整）。
ALTER TABLE notification_policies DROP CONSTRAINT notification_policies_has_override;
