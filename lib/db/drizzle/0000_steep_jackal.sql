CREATE TABLE "pilah_analysis" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"value_encrypted" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilah_auth" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"value_encrypted" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilah_chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"name_encrypted" text NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"disappearing" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"latest_activity" timestamp with time zone,
	"history_message_id" text,
	"history_from_owner" boolean DEFAULT false NOT NULL,
	"history_timestamp" integer
);
--> statement-breakpoint
CREATE TABLE "pilah_messages" (
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"sender_encrypted" text NOT NULL,
	"body_encrypted" text,
	"timestamp" timestamp with time zone NOT NULL,
	"from_owner" boolean NOT NULL,
	"unsupported_content" boolean DEFAULT false NOT NULL,
	"mentioned_owner" boolean DEFAULT false NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"quoted_message_id" text,
	CONSTRAINT "pilah_messages_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "pilah_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_provider" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilah_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pilah_analysis" ADD CONSTRAINT "pilah_analysis_chat_id_pilah_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pilah_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilah_messages" ADD CONSTRAINT "pilah_messages_chat_id_pilah_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."pilah_chats"("chat_id") ON DELETE cascade ON UPDATE no action;