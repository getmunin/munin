CREATE TABLE "cms_asset_references" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"from_entry_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"field_name" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_asset_references" ADD CONSTRAINT "cms_asset_references_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_references" ADD CONSTRAINT "cms_asset_references_from_entry_id_cms_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."cms_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_references" ADD CONSTRAINT "cms_asset_references_asset_id_cms_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."cms_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_asset_references_from_idx" ON "cms_asset_references" USING btree ("from_entry_id");--> statement-breakpoint
CREATE INDEX "cms_asset_references_asset_idx" ON "cms_asset_references" USING btree ("asset_id");--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  INSERT INTO cms_asset_references (id, org_id, from_entry_id, asset_id, field_name, kind, position)
  SELECT
    'cmar_' || encode(gen_random_bytes(12), 'hex'),
    e.org_id,
    e.id,
    e.data ->> f.field_name,
    f.field_name,
    'field',
    0
  FROM cms_entries e
  JOIN cms_collections c ON c.id = e.collection_id
  CROSS JOIN LATERAL jsonb_array_elements(c.fields) AS fld
  CROSS JOIN LATERAL (
    SELECT fld ->> 'name' AS field_name, fld ->> 'type' AS field_type
  ) f
  WHERE f.field_type = 'asset'
    AND jsonb_typeof(e.data -> f.field_name) = 'string'
    AND length(e.data ->> f.field_name) > 0
    AND EXISTS (SELECT 1 FROM cms_assets a WHERE a.id = e.data ->> f.field_name);

  INSERT INTO cms_asset_references (id, org_id, from_entry_id, asset_id, field_name, kind, position)
  SELECT
    'cmar_' || encode(gen_random_bytes(12), 'hex'),
    e.org_id,
    e.id,
    elem.value #>> '{}',
    f.field_name,
    'field',
    (elem.ordinality - 1)::int
  FROM cms_entries e
  JOIN cms_collections c ON c.id = e.collection_id
  CROSS JOIN LATERAL jsonb_array_elements(c.fields) AS fld
  CROSS JOIN LATERAL (
    SELECT
      fld ->> 'name' AS field_name,
      fld ->> 'type' AS field_type,
      fld -> 'options' -> 'items' ->> 'type' AS item_type
  ) f
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(e.data -> f.field_name) = 'array'
      THEN e.data -> f.field_name ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS elem(value, ordinality)
  WHERE f.field_type = 'array'
    AND f.item_type = 'asset'
    AND jsonb_typeof(elem.value) = 'string'
    AND length(elem.value #>> '{}') > 0
    AND EXISTS (SELECT 1 FROM cms_assets a WHERE a.id = elem.value #>> '{}');
END $$;