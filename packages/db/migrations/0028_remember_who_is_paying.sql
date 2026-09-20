-- What Stripe knows about a space: its customer, its subscription, how that
-- subscription is doing and what it is paid up to. The plan column stays the
-- one Cira reads; these are what set it. Additive only.
ALTER TABLE "spaces" ADD COLUMN "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "stripe_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "subscription_status" text;
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "paid_until" timestamp with time zone;
