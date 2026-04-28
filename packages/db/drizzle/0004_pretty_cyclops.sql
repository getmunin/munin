CREATE TABLE "crm_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"subject" text,
	"body" text,
	"contact_id" text,
	"company_id" text,
	"deal_id" text,
	"end_user_id" text,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" text NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"owner_user_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_summary" text,
	"ai_summary_at" timestamp with time zone,
	"ai_next_action" text,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"last_ai_touch_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"end_user_id" text,
	"company_id" text,
	"name" text,
	"email" text,
	"phone" text,
	"title" text,
	"address" text,
	"owner_user_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_summary" text,
	"ai_summary_at" timestamp with time zone,
	"ai_next_action" text,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"last_ai_touch_at" timestamp with time zone,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_deals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint,
	"currency" varchar(8),
	"primary_contact_id" text,
	"company_id" text,
	"owner_user_id" text,
	"expected_close_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"ai_summary" text,
	"ai_summary_at" timestamp with time zone,
	"ai_next_action" text,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"last_ai_touch_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"from_type" varchar(16) NOT NULL,
	"from_id" text NOT NULL,
	"to_type" varchar(16) NOT NULL,
	"to_id" text NOT NULL,
	"role" varchar(64) NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"win_loss" varchar(8) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_id_crm_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_primary_contact_id_crm_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activities_org_idx" ON "crm_activities" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activities_contact_idx" ON "crm_activities" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activities_deal_idx" ON "crm_activities" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activities_end_user_idx" ON "crm_activities" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "crm_companies_org_idx" ON "crm_companies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crm_companies_domain_idx" ON "crm_companies" USING btree ("org_id","domain");--> statement-breakpoint
CREATE INDEX "crm_contacts_org_idx" ON "crm_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_email_idx" ON "crm_contacts" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "crm_contacts_phone_idx" ON "crm_contacts" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "crm_contacts_end_user_idx" ON "crm_contacts" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_company_idx" ON "crm_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "crm_deals_org_idx" ON "crm_deals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crm_deals_pipeline_idx" ON "crm_deals" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "crm_deals_stage_idx" ON "crm_deals" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "crm_deals_contact_idx" ON "crm_deals" USING btree ("primary_contact_id");--> statement-breakpoint
CREATE INDEX "crm_deals_company_idx" ON "crm_deals" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipelines_slug_uq" ON "crm_pipelines" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "crm_relationships_org_idx" ON "crm_relationships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crm_relationships_from_idx" ON "crm_relationships" USING btree ("from_type","from_id");--> statement-breakpoint
CREATE INDEX "crm_relationships_to_idx" ON "crm_relationships" USING btree ("to_type","to_id");--> statement-breakpoint
CREATE INDEX "crm_stages_pipeline_idx" ON "crm_stages" USING btree ("pipeline_id","position");