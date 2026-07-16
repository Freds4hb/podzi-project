/**
 * POST /api/stripe/webhook — Stripe event receiver.
 *
 * Verifies the Stripe signature against STRIPE_WEBHOOK_SECRET, then routes
 * subscription lifecycle events so the local `subscriptions` + `users.planTier`
 * stay in sync with Stripe (the source of truth for billing state).
 *
 * Security:
 *  - Signature verification is mandatory; unverified requests are rejected 400.
 *  - We read the RAW request body (required for signature verification) — do not
 *    parse JSON before verifying.
 *
 * The handler is guarded so the scaffold builds without Stripe keys: if Stripe
 * is not configured it returns 503 rather than throwing at import time.
 */
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/integrations/stripe";

// Stripe webhooks must hit the Node runtime (raw body + crypto), not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // Raw body is required for signature verification.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${toMessage(err)}` },
      { status: 400 },
    );
  }

  // Route the events that affect entitlement. Each case is a TODO to persist to
  // the `subscriptions` table and update `users.planTier` accordingly.
  switch (event.type) {
    case "checkout.session.completed":
      // TODO(wire): create/activate the subscription for the customer.
      break;
    case "customer.subscription.updated":
    case "customer.subscription.created":
      // TODO(wire): upsert subscription row (tier, status, seats, periodEnd).
      break;
    case "customer.subscription.deleted":
      // TODO(wire): mark subscription canceled; downgrade user to free.
      break;
    default:
      // Unhandled event types are acknowledged so Stripe stops retrying.
      break;
  }

  return NextResponse.json({ received: true });
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
