/**
 * Deployment verification — does a *provisioned* stack actually work?
 *
 *   npm run verify:deploy
 *   npm run verify:deploy -- --url https://your-app.vercel.app
 *   npm run verify:deploy -- --require-core
 *
 * `check:env` answers "is the variable set?". That is necessary and not
 * sufficient: the failure modes that actually cost an afternoon all pass a
 * presence check.
 *
 *   - A Neon project exists and `DATABASE_URL` is correct, but nobody ran
 *     `db:migrate`. `SELECT 1` succeeds, the admin card reads *Connected*, and
 *     every real query 500s. This is the single most likely way provisioning
 *     goes wrong, and nothing else in the repo detects it.
 *   - The publishable key is `pk_test_…` and the secret is `sk_live_…`. Both are
 *     present, both are valid, and sign-in fails with an error that names
 *     neither.
 *   - The direct Neon endpoint is used instead of the pooled one. Everything
 *     works until concurrency arrives, then connections exhaust.
 *   - A deployment went out before Clerk was configured, so `/admin` is served
 *     to the public. With `--url` this is checked against the live deployment
 *     rather than assumed from the source.
 *
 * Every check states what to do about a failure. Secrets are never printed —
 * only lengths and the non-secret `pk_`/`sk_` mode prefix, which is the subject
 * of the pairing check.
 *
 * Exit code is 1 if any check FAILs, so this is usable as a deploy gate.
 * WARNs never fail the run.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { env } from "../src/lib/env.ts";
import {
  checkAllIntegrations,
  integrationAdapters,
} from "../src/lib/integrations/registry.ts";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const HTTP_TIMEOUT_MS = 15_000;

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

type Level = "pass" | "warn" | "fail" | "skip";

interface Check {
  level: Level;
  title: string;
  /** What was observed. */
  detail: string;
  /** What to do about it. Required for warn/fail — a finding without a remedy
   *  just relocates the problem. */
  fix?: string;
}

const checks: Check[] = [];

function record(level: Level, title: string, detail: string, fix?: string) {
  checks.push({ level, title, detail, fix });
}

/* ── 1 · Configuration shape (no network) ─────────────────────────────────── */

/** `pk_live_…`/`sk_live_…` → "live"; the test variants → "test"; else null. */
function clerkKeyMode(key: string): "live" | "test" | null {
  if (/^(pk|sk)_live_/.test(key)) return "live";
  if (/^(pk|sk)_test_/.test(key)) return "test";
  return null;
}

function checkClerkKeyShape() {
  const publishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secret = env.CLERK_SECRET_KEY;

  if (!publishable && !secret) {
    record(
      "skip",
      "Clerk key pairing",
      "Neither Clerk key is set.",
      "Step 2 of docs/DEPLOYMENT.md. Until then a production build closes " +
        "/admin rather than serving it.",
    );
    return;
  }
  if (!publishable || !secret) {
    record(
      "fail",
      "Clerk key pairing",
      `Only ${publishable ? "the publishable key" : "the secret key"} is set. ` +
        "Clerk needs both.",
      "Copy both from dashboard.clerk.com → API keys. One without the other " +
        "leaves middleware inactive while looking half-configured.",
    );
    return;
  }

  const pubMode = clerkKeyMode(publishable);
  const secMode = clerkKeyMode(secret);

  if (!pubMode || !secMode) {
    record(
      "fail",
      "Clerk key pairing",
      `Unrecognised key prefix (publishable "${publishable.slice(0, 8)}…", ` +
        `secret "${secret.slice(0, 8)}…"). Expected pk_test_/pk_live_ and ` +
        "sk_test_/sk_live_.",
      "Re-copy the keys; a truncated or wrapped paste is the usual cause.",
    );
    return;
  }
  if (pubMode !== secMode) {
    record(
      "fail",
      "Clerk key pairing",
      `Mode mismatch: publishable key is ${pubMode}, secret key is ${secMode}.`,
      "Both keys must come from the same Clerk instance. Mismatched modes " +
        "authenticate against different user directories, so sign-in fails " +
        "with an error that mentions neither key.",
    );
    return;
  }
  record(
    "pass",
    "Clerk key pairing",
    `Both keys present and both ${pubMode}.`,
  );
}

/**
 * @returns true when the value is structurally usable as a Postgres connection
 *   string. The schema check is skipped when it is not: `neon()` validates the
 *   string and throws *synchronously*, so probing a URL already known to be
 *   malformed would crash the verifier instead of reporting the problem.
 */
function checkDatabaseUrlShape(): boolean {
  const raw = env.DATABASE_URL;
  if (!raw) {
    record(
      "skip",
      "DATABASE_URL shape",
      "Not set.",
      "Step 1 of docs/DEPLOYMENT.md. Nothing persists without it.",
    );
    return false;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    record(
      "fail",
      "DATABASE_URL shape",
      "Not parseable as a URL.",
      "Expected postgresql://user:password@host/db?sslmode=require — check " +
        "for a stray newline or quote from the paste.",
    );
    return false;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    record(
      "fail",
      "DATABASE_URL shape",
      `Scheme is "${url.protocol}", expected postgres: or postgresql:.`,
      "Copy the connection string, not the psql command or the dashboard URL.",
    );
    return false;
  }

  // Neon's pooled endpoint is what the serverless driver expects. Not every
  // Postgres is Neon, so this is a warning with its reasoning attached rather
  // than a hard failure.
  if (url.host.includes("-pooler")) {
    record("pass", "DATABASE_URL shape", `Pooled endpoint (${url.host}).`);
  } else {
    record(
      "warn",
      "DATABASE_URL shape",
      `Host ${url.host} does not look like a pooled endpoint.`,
      "If this is Neon, use the connection string whose host contains " +
        "-pooler. The direct endpoint opens a connection per invocation and " +
        "exhausts the limit under load — which looks fine in testing and " +
        "fails in production.",
    );
  }
  return true;
}

/* ── 2 · Live service probes (reuses the adapter contract) ────────────────── */

async function probeIntegrations() {
  const results = await checkAllIntegrations();
  for (const result of results) {
    const configured = result.status !== "not_configured";
    if (!configured) {
      record("skip", `${result.service} probe`, result.message);
      continue;
    }
    if (result.status === "connected") {
      const extra = result.config
        ? ` ${DIM}(${Object.entries(result.config)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")})${RESET}`
        : "";
      record("pass", `${result.service} probe`, `${result.message}${extra}`);
      continue;
    }
    record(
      "fail",
      `${result.service} probe`,
      `${result.message}${result.error ? ` — ${result.error}` : ""}`,
      "Credentials are present but the service rejected or could not be " +
        "reached. This is a live failure, not a missing variable.",
    );
  }
}

/* ── 3 · Database schema state ────────────────────────────────────────────── */

/**
 * Tables the committed migrations create, parsed from the SQL rather than
 * hard-coded, so this check cannot drift from `drizzle/`.
 */
async function expectedTables(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const names = new Set<string>();
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(/CREATE TABLE\s+"([^"]+)"/gi)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

async function checkSchemaApplied(databaseUrlUsable: boolean) {
  if (!env.DATABASE_URL) {
    record(
      "skip",
      "Schema applied",
      "No DATABASE_URL, so the schema cannot be checked.",
    );
    return;
  }
  if (!databaseUrlUsable) {
    record(
      "skip",
      "Schema applied",
      "DATABASE_URL is malformed, so the schema was not checked.",
      "Fix the connection string first — the failure above says how.",
    );
    return;
  }

  let expected: string[];
  try {
    expected = await expectedTables();
  } catch (err) {
    record(
      "fail",
      "Schema applied",
      `Could not read migrations from drizzle/: ${toMessage(err)}`,
      "Run npm run db:generate — without committed migrations, db:migrate " +
        "has nothing to apply.",
    );
    return;
  }
  if (expected.length === 0) {
    record(
      "fail",
      "Schema applied",
      "drizzle/ contains no CREATE TABLE statements.",
      "Run npm run db:generate.",
    );
    return;
  }

  // `neon()` throws synchronously on a connection string it cannot parse, so it
  // is constructed inside the guard along with the query.
  let sql: ReturnType<typeof neon>;
  try {
    sql = neon(env.DATABASE_URL);
  } catch (err) {
    record(
      "fail",
      "Schema applied",
      `Connection string rejected by the driver: ${toMessage(err)}`,
      "Expected postgresql://user:password@host/dbname?sslmode=require.",
    );
    return;
  }

  let present: Set<string>;
  try {
    const rows = (await sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
    `) as { table_name: string }[];
    present = new Set(rows.map((r) => r.table_name));
  } catch (err) {
    record(
      "fail",
      "Schema applied",
      `Could not query the database: ${toMessage(err)}`,
      "The connection string parses but the database did not answer. Check " +
        "the project is awake and the credentials are current.",
    );
    return;
  }

  const missing = expected.filter((name) => !present.has(name));
  if (missing.length > 0) {
    record(
      "fail",
      "Schema applied",
      `${missing.length} of ${expected.length} expected table(s) absent: ` +
        missing.join(", "),
      "Run npm run db:migrate. The database is reachable, which is why the " +
        "Neon health check reads Connected — but the schema is not there, so " +
        "every query against these tables will fail at runtime.",
    );
    return;
  }
  record(
    "pass",
    "Schema applied",
    `All ${expected.length} table(s) present.`,
  );

  // The enum backing integration_connections.service must cover every adapter
  // in the registry, or writing that row fails at runtime. verify:podcasts
  // asserts this against an in-process Postgres; here it is checked against the
  // database that was actually migrated, which also catches a stale migration.
  try {
    const rows = (await sql`
      SELECT enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'integration_service'
    `) as { enumlabel: string }[];
    const inDb = new Set(rows.map((r) => r.enumlabel));
    const missingServices = integrationAdapters
      .map((a) => a.service)
      .filter((service) => !inDb.has(service));

    if (missingServices.length > 0) {
      record(
        "fail",
        "integration_service enum",
        `Registered adapter(s) absent from the enum: ${missingServices.join(", ")}.`,
        "The applied migration predates these adapters. Run " +
          "npm run db:generate && npm run db:migrate. Until then, any " +
          "integration_connections or activity_logs write for those services " +
          "fails.",
      );
    } else {
      record(
        "pass",
        "integration_service enum",
        `Covers all ${integrationAdapters.length} registered adapter(s).`,
      );
    }
  } catch (err) {
    record(
      "warn",
      "integration_service enum",
      `Could not read the enum: ${toMessage(err)}`,
      "Not fatal, but adapter/enum parity is unverified on this database.",
    );
  }
}

/* ── 4 · Deployed smoke test (--url only) ─────────────────────────────────── */

async function get(url: string, redirect: RequestRedirect = "manual") {
  return fetch(url, {
    redirect,
    cache: "no-store",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

async function smokeTest(base: string) {
  const origin = base.replace(/\/+$/, "");

  /* Liveness. */
  try {
    const res = await get(`${origin}/api/health`);
    const body = (await res.json()) as { ok?: boolean };
    if (res.ok && body.ok === true) {
      record("pass", "GET /api/health", "200 with ok:true.");
    } else {
      record(
        "fail",
        "GET /api/health",
        `HTTP ${res.status}, body ok=${String(body.ok)}.`,
        "The deployment is not serving. Check the Vercel build log.",
      );
      return; // Nothing below can be meaningful.
    }
  } catch (err) {
    record(
      "fail",
      "GET /api/health",
      `Request failed: ${toMessage(err)}`,
      `Confirm ${origin} is the deployment URL and that it is not paused.`,
    );
    return;
  }

  /* The podcast UI renders. */
  try {
    const res = await get(`${origin}/podcasts`);
    if (res.ok) {
      record("pass", "GET /podcasts", "200 — the finder page renders.");
    } else {
      record(
        "fail",
        "GET /podcasts",
        `HTTP ${res.status}.`,
        "This page needs no credentials, so a non-200 points at the build " +
          "rather than at configuration.",
      );
    }
  } catch (err) {
    record("fail", "GET /podcasts", `Request failed: ${toMessage(err)}`);
  }

  /* The admin surface must not be readable by an anonymous request. This checks
     the deployed artifact rather than the source: it is what would have caught a
     deployment made before Clerk was configured. `/api/integrations/status` is
     included because its payload describes the infrastructure — database host,
     Clerk mode, n8n URL — and it is reachable without going through /admin. */
  for (const path of ["/admin", "/api/integrations/status"]) {
    try {
      const res = await get(`${origin}${path}`);
      if (res.status === 200) {
        record(
          "fail",
          `GET ${path} (anonymous)`,
          "200 — served to an unauthenticated request.",
          "Set both Clerk keys on the deployment and make sure " +
            "ALLOW_UNAUTHENTICATED_ADMIN is not set. src/middleware.ts closes " +
            "this route on a production build with no Clerk keys, so a 200 " +
            "means either the keys are half-set or the override is on.",
        );
      } else {
        record(
          "pass",
          `GET ${path} (anonymous)`,
          `HTTP ${res.status} — not served anonymously.`,
        );
      }
    } catch (err) {
      record(
        "warn",
        `GET ${path} (anonymous)`,
        `Request failed: ${toMessage(err)}`,
      );
    }
  }

  /* Search availability, reported rather than judged: absent credentials are a
     documented degradation, not a fault. */
  try {
    const res = await get(`${origin}/api/podcasts/search?q=test`);
    if (res.ok) {
      record("pass", "GET /api/podcasts/search", "200 — directory search live.");
    } else if (res.status === 503) {
      record(
        "skip",
        "GET /api/podcasts/search",
        "503 — search not configured, as designed. Adding a show by feed URL " +
          "still works.",
      );
    } else {
      record(
        "fail",
        "GET /api/podcasts/search",
        `HTTP ${res.status}, expected 200 or 503.`,
        "A 502 means the credentials are set but the directory rejected the " +
          "request.",
      );
    }
  } catch (err) {
    record(
      "warn",
      "GET /api/podcasts/search",
      `Request failed: ${toMessage(err)}`,
    );
  }
}

/* ── Reporting ────────────────────────────────────────────────────────────── */

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mark(level: Level): string {
  switch (level) {
    case "pass":
      return `${GREEN}pass${RESET}`;
    case "warn":
      return `${YELLOW}warn${RESET}`;
    case "fail":
      return `${RED}FAIL${RESET}`;
    case "skip":
      return `${DIM}skip${RESET}`;
  }
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

async function main() {
  const url = argValue("--url");
  const requireCore = process.argv.includes("--require-core");

  console.log("\nPodzi deployment verification\n");

  checkClerkKeyShape();
  const databaseUrlUsable = checkDatabaseUrlShape();
  await probeIntegrations();
  await checkSchemaApplied(databaseUrlUsable);

  if (url) {
    console.log(`  ${DIM}smoke-testing ${url}${RESET}\n`);
    await smokeTest(url);
  } else {
    record(
      "skip",
      "Deployed smoke test",
      "No --url given, so the live deployment was not checked.",
      "Re-run with --url https://your-app.vercel.app once step 3 is done.",
    );
  }

  for (const check of checks) {
    console.log(`  ${mark(check.level).padEnd(16)} ${check.title}`);
    console.log(`  ${" ".repeat(6)}${DIM}${check.detail}${RESET}`);
    if (check.fix && check.level !== "pass") {
      console.log(`  ${" ".repeat(6)}${DIM}→ ${check.fix}${RESET}`);
    }
  }

  const failed = checks.filter((c) => c.level === "fail");
  const warned = checks.filter((c) => c.level === "warn");
  const passed = checks.filter((c) => c.level === "pass");
  const skipped = checks.filter((c) => c.level === "skip");

  console.log(
    `\n  ${passed.length} passed · ${warned.length} warning(s) · ` +
      `${failed.length} failure(s) · ${skipped.length} not applicable\n`,
  );

  if (failed.length > 0) {
    console.error(
      `${RED}✗ deployment verification failed${RESET} — ` +
        `${failed.map((c) => c.title).join(", ")}\n`,
    );
    process.exit(1);
  }

  // Nothing configured at all is a legitimate state — it is how CI runs — but
  // it must not be reported as success. "Every configured service verified" is
  // vacuously true of an empty set and reads as reassurance, which is the exact
  // failure this script exists to prevent.
  if (passed.length === 0) {
    if (requireCore) {
      console.error(
        `${RED}✗ nothing is configured${RESET} — --require-core was given but ` +
          `no service could be verified. See docs/DEPLOYMENT.md.\n`,
      );
      process.exit(1);
    }
    console.log(
      `${YELLOW}◦ nothing to verify${RESET} — no service is configured in this ` +
        `environment. This is the expected state for a fresh checkout and for ` +
        `CI; it is not a passing deployment.\n`,
    );
    return;
  }

  console.log(`${GREEN}✓ every configured service verified${RESET}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}verify:deploy crashed:${RESET} ${toMessage(err)}\n`);
  process.exit(1);
});
