-- 權限圖 G3b（docs/adr/0024-relationship-based-access-control.md）：刪掉 G1 的同步 trigger 與三張舊表。
-- G3a 起程式只讀寫 relation_tuples；舊表與 trigger 只為了滾動部署期間的舊版（G2）程序而保留（02-database.md §5.1），
-- 所以這支 migration 要在 G3a 部署之後的下一次部署才跑。**不可回退**：舊表的資料不再回填。
-- DROP TABLE、DROP TYPE 由 drizzle-kit 產生；trigger 與函式為手寫。

-- ── migration 0008 的同步 trigger 與函式 ─────────────────────────
-- 舊表上的 trigger 會隨 DROP TABLE 一起刪，這裡先刪是為了讓函式能刪；roles 上的那個一定要自己刪。
DROP TRIGGER IF EXISTS roles_mirror_super_admin ON roles;
--> statement-breakpoint
DROP FUNCTION IF EXISTS relation_tuples_mirror_super_admin();
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_roles_mirror_tuples ON user_roles;
--> statement-breakpoint
DROP FUNCTION IF EXISTS relation_tuples_mirror_user_roles();
--> statement-breakpoint
DROP TRIGGER IF EXISTS role_permissions_mirror_tuples ON role_permissions;
--> statement-breakpoint
DROP FUNCTION IF EXISTS relation_tuples_mirror_role_permissions();
--> statement-breakpoint
DROP TRIGGER IF EXISTS resource_grants_mirror_tuples ON resource_grants;
--> statement-breakpoint
DROP FUNCTION IF EXISTS relation_tuples_mirror_resource_grants();
--> statement-breakpoint
-- 參數型別是 grant_subject_type：要在 DROP TYPE 之前刪
DROP FUNCTION IF EXISTS relation_tuples_grant_subject(grant_subject_type, uuid);
--> statement-breakpoint

-- ── 舊表與它們的 enum ──────────────────────────────────────────
DROP TABLE "resource_grants";
--> statement-breakpoint
DROP TABLE "role_permissions";
--> statement-breakpoint
DROP TABLE "user_roles";
--> statement-breakpoint
DROP TYPE "public"."grant_level";
--> statement-breakpoint
DROP TYPE "public"."grant_subject_type";
--> statement-breakpoint
DROP TYPE "public"."resource_type";
