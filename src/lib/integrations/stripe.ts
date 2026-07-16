/**
 * Stripe payments integration adapter.
 *
 * Health check performs a cheap, read-only Balance retrieval, which validates
 * the secret key and connectivity without creating or mutating anything.
 * Subscription lifecycle is kept in sync elsewhere via the webhook route
 * (src/app/api/stripe/webhook/route.ts).
 */
import Stripe from "stripe";
import { env } from "@/lib/env";
import { health, type IntegrationAdapter } from "./types";

/**
 * Lazily construct the Stripe client so importing this module never throws when
 * the key is absent (the scaffold must build without credentials).
 */
export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  return new Stripe(env.STRIPE_SECRET_KEY, {
    // Pin the API version so Stripe's behavior is stable across deploys.
    // Must match the version the installed SDK's types expect.
    apiVersion: "2025-02-24.acacia",
    appInfo: { name: "podzi-platform" },
  });
}

export const stripeAdapter: IntegrationAdapter = {
  service: "stripe",
  label: "Stripe",
  description: "Payments and subscription billing (Free / Pro / Family Pro).",

  isConfigured() {
    return Boolean(env.STRIPE_SECRET_KEY);
  },

  async healthCheck() {
    if (!this.isConfigured()) {
      return health("stripe", "not_configured", "STRIPE_SECRET_KEY is not set.");
    }
    try {
      const stripe = getStripe();
      await stripe.balance.retrieve();
      const mode = env.STRIPE_SECRET_KEY.startsWith("sk_live") ? "live" : "test";
      const webhook = env.STRIPE_WEBHOOK_SECRET ? "configured" : "missing";
      return health("stripe", "connected", "Stripe API reachable.", {
        config: { mode, webhookSecret: webhook },
      });
    } catch (err) {
      return health("stripe", "error", "Could not reach Stripe.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
