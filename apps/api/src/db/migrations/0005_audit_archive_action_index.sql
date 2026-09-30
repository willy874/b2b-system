-- 冷表的 action 前綴查詢。冷表很大時建索引期間會擋住封存的寫入，
-- 已上線的租戶請在離峰時段跑 db:migrate。
CREATE INDEX "audit_logs_archive_action_idx" ON "audit_logs_archive" USING btree ("action" text_pattern_ops,"occurred_at" DESC NULLS FIRST);