ALTER TABLE "pilah_preferences" ADD COLUMN "owner_account_hash" text;--> statement-breakpoint
ALTER TABLE "pilah_sessions" ADD COLUMN "purpose" text DEFAULT 'owner' NOT NULL;