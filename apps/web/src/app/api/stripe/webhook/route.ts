import { NextResponse } from "next/server";
import { applySubscription, verifyWebhook, webhookSecrets } from "@/lib/billing";
import { paymentFailedMessage, subscriptionEndedMessage } from "@/lib/messages";
import { notifyAdmins } from "@/lib/notify";
import { enforcePlan } from "@/lib/plan-enforcement";
import { db, spaces } from "@cira/db";
import { eq } from "drizzle-orm";

/**
 * What Stripe says happened.
 *
 * The one place Cira takes a fact about money from outside, so the signature
 * is checked before the body is read as anything at all, and the body is read
 * raw for exactly that reason. Everything that changes what a company may do
 * arrives here rather than from the browser that came back from checkout: a
 * redirect can be faked, and a person can close the tab before it happens.
 *
 * An event is only ever a pointer: `applySubscription` fetches the
 * subscription as it is now, so the order events arrive in cannot matter.
 */
export async function POST(request: Request) {
  // The configured secret, and the one for an endpoint Cira made itself.
  const secrets = await webhookSecrets();
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const payload = await request.text();
  const header = request.headers.get("stripe-signature");
  if (!secrets.some((secret) => verifyWebhook({ payload, header, secret }))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = event.data?.object ?? {};

  // A finished checkout names the subscription it made; applying it here as
  // well as on its own event means the page someone returns to is right
  // sooner, whichever of the two arrives first.
  const subscriptionId =
    event.type?.startsWith("customer.subscription.") === true
      ? (object["id"] as string | undefined)
      : event.type === "checkout.session.completed" ||
          event.type === "invoice.payment_failed"
        ? (object["subscription"] as string | undefined)
        : undefined;

  if (subscriptionId !== undefined && subscriptionId !== null) {
    const applied = await applySubscription({ id: subscriptionId });

    if (applied.kind === "applied") {
      const ended =
        applied.before !== applied.after &&
        ["canceled", "unpaid", "incomplete_expired", "paused"].includes(applied.after);
      if (ended) {
        // Stopped paying: what runs by the hour stops now, not at the
        // watcher's next pass, and the admins are told what changed.
        await enforcePlan(applied.spaceId).catch(() => undefined);
        await notifyAdmins({
          spaceId: applied.spaceId,
          kind: "subscription-ended",
          subject: subscriptionId,
          compose: (space) => subscriptionEndedMessage({ space }),
        });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const spaceId =
        applied.kind === "applied" ? applied.spaceId : await spaceOfCustomer(object);
      if (spaceId !== null) {
        await notifyAdmins({
          spaceId,
          kind: "payment-failed",
          subject: String(object["id"] ?? event.id ?? subscriptionId),
          compose: (space) => paymentFailedMessage({ space }),
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}

async function spaceOfCustomer(invoice: Record<string, unknown>): Promise<string | null> {
  const customer = invoice["customer"];
  if (typeof customer !== "string") return null;
  const [row] = await db()
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.stripeCustomerId, customer))
    .limit(1);
  return row?.id ?? null;
}
