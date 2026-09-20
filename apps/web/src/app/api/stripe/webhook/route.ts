import { NextResponse } from "next/server";
import { applySubscription, verifyWebhook } from "@/lib/billing";

/**
 * What Stripe says happened.
 *
 * The one place Cira takes a fact about money from outside, so the signature
 * is checked before the body is read as anything at all, and the body is read
 * raw for exactly that reason. Everything that changes what a company may do
 * arrives here rather than from the browser that came back from checkout: a
 * redirect can be faked, and a person can close the tab before it happens.
 */
export async function POST(request: Request) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"]?.trim();
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const payload = await request.text();
  if (
    !verifyWebhook({ payload, header: request.headers.get("stripe-signature"), secret })
  ) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  const object = event.data?.object ?? {};

  // Subscription events carry the subscription itself. A finished checkout
  // does not, and does not need to: the subscription it created sends its own.
  if (event.type?.startsWith("customer.subscription.") === true) {
    await applySubscription(object);
  }

  return NextResponse.json({ received: true });
}
