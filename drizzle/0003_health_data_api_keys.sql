CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"prefix_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"steps" integer,
	"distance_m" real,
	"flights" integer,
	"active_kcal" real,
	"resting_kcal" real,
	"exercise_min" real,
	"stand_min" real,
	"daylight_min" real,
	"mindful_min" real,
	"resting_hr" real,
	"walking_hr_avg" real,
	"hrv_sdnn_ms" real,
	"vo2max" real,
	"spo2_pct" real,
	"resp_rate" real,
	"wrist_temp_c" real,
	"weight_kg" real,
	"body_fat_pct" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_metrics_user_id_local_date_pk" PRIMARY KEY("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "daily_scores" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"sleep_score" real,
	"recovery" real,
	"strain" real,
	"components" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_scores_user_id_local_date_pk" PRIMARY KEY("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "hr_hourly" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"hour" smallint NOT NULL,
	"min" real,
	"avg" real NOT NULL,
	"max" real,
	CONSTRAINT "hr_hourly_user_id_local_date_hour_pk" PRIMARY KEY("user_id","local_date","hour"),
	CONSTRAINT "hr_hourly_hour" CHECK ("hr_hourly"."hour" between 0 and 23)
);
--> statement-breakpoint
CREATE TABLE "ingest_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" smallint NOT NULL,
	"auth_method" text NOT NULL,
	"bytes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"summary" jsonb,
	"body" jsonb,
	"errors" jsonb,
	CONSTRAINT "ingest_events_auth_method" CHECK ("ingest_events"."auth_method" in ('bearer', 'query'))
);
--> statement-breakpoint
CREATE TABLE "sleep_nights" (
	"user_id" uuid NOT NULL,
	"wake_date" date NOT NULL,
	"chosen_source" text NOT NULL,
	"bed_start" timestamp with time zone NOT NULL,
	"bed_end" timestamp with time zone NOT NULL,
	"in_bed_min" real,
	"asleep_min" real,
	"awake_min" real,
	"core_min" real,
	"deep_min" real,
	"rem_min" real,
	"has_stages" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sleep_nights_user_id_wake_date_pk" PRIMARY KEY("user_id","wake_date")
);
--> statement-breakpoint
CREATE TABLE "sleep_segments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"wake_date" date NOT NULL,
	"stage" text NOT NULL,
	"start_ts" timestamp with time zone NOT NULL,
	"end_ts" timestamp with time zone NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	CONSTRAINT "sleep_segments_stage" CHECK ("sleep_segments"."stage" in ('in_bed', 'asleep', 'awake', 'core', 'deep', 'rem')),
	CONSTRAINT "sleep_segments_order" CHECK ("sleep_segments"."end_ts" >= "sleep_segments"."start_ts")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_scores" ADD CONSTRAINT "daily_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_hourly" ADD CONSTRAINT "hr_hourly_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_nights" ADD CONSTRAINT "sleep_nights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_segments" ADD CONSTRAINT "sleep_segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_one_active_per_user" ON "api_keys" USING btree ("user_id") WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ingest_events_user_received_idx" ON "ingest_events" USING btree ("user_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingest_events_received_idx" ON "ingest_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "sleep_segments_user_wake_idx" ON "sleep_segments" USING btree ("user_id","wake_date");