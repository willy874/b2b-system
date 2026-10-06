CREATE TABLE "platform_environment" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_environment_single_row" CHECK ("platform_environment"."id" = 1)
);
