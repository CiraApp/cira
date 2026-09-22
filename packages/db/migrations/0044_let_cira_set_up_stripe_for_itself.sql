-- What Cira set up in Stripe for itself, per mode: the webhook endpoint it
-- made, the secret that endpoint's events are signed with, and when it was
-- last checked.
CREATE TABLE "stripe_setup" (
  "mode" text PRIMARY KEY NOT NULL,
  "webhook_endpoint_id" text,
  "webhook_secret" text,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
