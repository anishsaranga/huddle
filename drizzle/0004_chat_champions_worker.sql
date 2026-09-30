CREATE TABLE "champion_awards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"category" text NOT NULL,
	"user_id" uuid NOT NULL,
	"value" real,
	"message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "champion_awards_category" CHECK ("champion_awards"."category" in ('sleep', 'recovery', 'strain', 'steps', 'improved'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_kind" CHECK ("messages"."kind" in ('text', 'champions', 'system'))
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji"),
	CONSTRAINT "reactions_emoji_length" CHECK (char_length("reactions"."emoji") between 1 and 16)
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"job" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"info" jsonb
);
--> statement-breakpoint
ALTER TABLE "champion_awards" ADD CONSTRAINT "champion_awards_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champion_awards" ADD CONSTRAINT "champion_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champion_awards" ADD CONSTRAINT "champion_awards_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "champion_awards_group_week_category_idx" ON "champion_awards" USING btree ("group_id","week_start","category");--> statement-breakpoint
CREATE INDEX "champion_awards_user_week_idx" ON "champion_awards" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "messages_group_id_id_idx" ON "messages" USING btree ("group_id","id" DESC NULLS LAST);