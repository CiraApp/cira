-- Whether an app answers for a route and whether Cira may call it are two
-- different questions, and until now one column answered both.
--
-- `verified_at` was stamped for any reply that was not a 404, on the reasoning
-- that a routed request proves the route is there. True, and not enough: an
-- app that signs its own users in routes the request and then refuses it, and
-- that refusal was recorded as confirmation. Every one of Wave's nineteen
-- enabled reads was published to agents this way, and every one of them
-- returned 401 to the first agent that called it.
CREATE TYPE "capability_reach" AS ENUM ('pending', 'callable', 'refused');
--> statement-breakpoint
-- Everything starts pending, including the rows that currently look verified.
-- Deliberately not backfilled to 'callable' from `verified_at`: that stamp is
-- exactly the evidence that turned out not to mean what it said, so carrying
-- it forward would carry the bug forward with it. The app gets asked again,
-- and this time the answer has somewhere to go.
ALTER TABLE "capabilities" ADD COLUMN "reach" "capability_reach" DEFAULT 'pending' NOT NULL;
