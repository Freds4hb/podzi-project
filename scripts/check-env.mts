/**
 * Environment preflight.
 *
 *   npm run check:env            # report what is set, exit 0 regardless
 *   npm run check:env -- --require-core   # exit 1 unless the core stack is set
 *
 * The app is built to run with nothing configured — that is a feature, not an
 * accident. The cost of that is silence: you can deploy a build that starts
 * cleanly and then discover at runtime that half the product is switched off.
 * This script makes the configuration state explicit, says what each variable
 * gates, and (with --require-core) fails a deploy that is missing the things a
 * usable deployment actually needs.
 *
 * It never prints a secret. Only whether a value is present, and its length.
 */
import { env, type EnvKey } from "../src/lib/env.ts";

interface Requirement {
  key: EnvKey;
  /** What breaks without it. */
  gates: string;
  /** Core = a usable deployment needs it. Optional = degrades cleanly. */
  core: boolean;
}

interface ServiceGroup {
  service: string;
  /** How to obtain the values. */
  source: string;
  requirements: Requirement[];
}

const GROUPS: ServiceGroup[] = [
  {
    service: "Neon (database)",
    source: "neon.tech → project → Connection string (POOLED)",
    requirements: [
      {
        key: "DATABASE_URL",
        core: true,
        gates:
          "everything persistent: following shows, the library, stitch jobs. " +
          "Without it /api/podcasts/follow, /library and /stitches return 503.",
      },
      {
        key: "DATABASE_URL_UNPOOLED",
        core: false,
        gates: "optional direct connection for migrations",
      },
    ],
  },
  {
    service: "Clerk (auth)",
    source: "dashboard.clerk.com → API keys",
    requirements: [
      {
        key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        core: true,
        gates:
          "sign-in, and any user-scoped write. While absent, a production " +
          "build CLOSES the admin surface (503) rather than serving it, and " +
          "no request can be attributed to a user. Locally the admin surface " +
          "stays open for convenience.",
      },
      {
        key: "CLERK_SECRET_KEY",
        core: true,
        gates: "server-side session verification and the Clerk health check",
      },
    ],
  },
  {
    service: "Stripe (billing)",
    source: "dashboard.stripe.com → Developers → API keys / Webhooks",
    requirements: [
      { key: "STRIPE_SECRET_KEY", core: false, gates: "billing + plan tiers" },
      {
        key: "STRIPE_WEBHOOK_SECRET",
        core: false,
        gates:
          "signature verification on /api/stripe/webhook. Without it the " +
          "route rejects every event, so subscriptions never sync.",
      },
    ],
  },
  {
    service: "Podcast Index (directory search)",
    source: "api.podcastindex.org → free developer key",
    requirements: [
      {
        key: "PODCAST_INDEX_API_KEY",
        core: false,
        gates:
          "keyword search. Adding a show by feed URL works without it, so " +
          "search degrades to a 503 the UI explains rather than breaking.",
      },
      { key: "PODCAST_INDEX_API_SECRET", core: false, gates: "same as above" },
    ],
  },
  {
    service: "Object storage (stitched audio)",
    source: "Cloudflare R2 (recommended — zero egress) or any S3-compatible",
    requirements: [
      {
        key: "AUDIO_STORAGE_BUCKET",
        core: false,
        gates:
          "durable audio output. Without it the worker writes to local disk, " +
          "which is ephemeral on any serverless or container host.",
      },
      { key: "AUDIO_STORAGE_ENDPOINT", core: false, gates: "S3/R2 endpoint" },
      { key: "AUDIO_STORAGE_ACCESS_KEY_ID", core: false, gates: "storage auth" },
      {
        key: "AUDIO_STORAGE_SECRET_ACCESS_KEY",
        core: false,
        gates: "storage auth",
      },
    ],
  },
  {
    service: "Transcription + summarization",
    source: "any OpenAI-compatible endpoint, or self-hosted Whisper",
    requirements: [
      {
        key: "TRANSCRIPTION_API_KEY",
        core: false,
        gates:
          "transcripts, and therefore summaries and smart-trim. Absent, the " +
          "pipeline runs audio-only — stitches still play.",
      },
      { key: "SUMMARIZATION_API_KEY", core: false, gates: "episode summaries" },
    ],
  },
  {
    service: "Vercel (hosting, admin visibility only)",
    source: "vercel.com → Account Settings → Tokens",
    requirements: [
      {
        key: "VERCEL_API_TOKEN",
        core: false,
        gates: "the Vercel card on /admin. Deployment itself does not need it.",
      },
    ],
  },
  {
    service: "n8n (ops automation)",
    source: "your n8n instance",
    requirements: [
      { key: "N8N_BASE_URL", core: false, gates: "low-volume ops automation" },
      { key: "N8N_API_KEY", core: false, gates: "same as above" },
    ],
  },
];

const GREEN = "[32m";
const YELLOW = "[33m";
const RED = "[31m";
const DIM = "[2m";
const RESET = "[0m";

function main() {
  const requireCore = process.argv.includes("--require-core");
  const missingCore: Requirement[] = [];
  let setCount = 0;
  let totalCount = 0;

  console.log("\nPodzi environment preflight\n");

  for (const group of GROUPS) {
    console.log(`  ${group.service}`);
    console.log(`  ${DIM}${group.source}${RESET}`);

    for (const requirement of group.requirements) {
      totalCount += 1;
      const value = env[requirement.key];
      const present = Boolean(value);
      if (present) setCount += 1;
      if (!present && requirement.core) missingCore.push(requirement);

      const mark = present
        ? `${GREEN}set${RESET}`
        : requirement.core
          ? `${RED}MISSING${RESET}`
          : `${YELLOW}unset${RESET}`;
      // Length only — never the value itself.
      const size = present ? ` ${DIM}(${value.length} chars)${RESET}` : "";

      console.log(`    ${mark.padEnd(20)} ${requirement.key}${size}`);
      if (!present) {
        console.log(`      ${DIM}gates: ${requirement.gates}${RESET}`);
      }
    }
    console.log("");
  }

  console.log(`  ${setCount}/${totalCount} variables set.`);

  if (missingCore.length > 0) {
    console.log(
      `\n  ${RED}${missingCore.length} core variable(s) missing:${RESET} ` +
        missingCore.map((r) => r.key).join(", "),
    );
    console.log(
      `  ${DIM}The app will still build and serve, but the features above are off.${RESET}`,
    );
    if (requireCore) {
      console.error(
        `\n${RED}✗ preflight failed: core configuration incomplete${RESET}\n`,
      );
      process.exit(1);
    }
  } else {
    console.log(`\n  ${GREEN}✓ core stack configured${RESET}`);
  }

  console.log("");
}

main();
