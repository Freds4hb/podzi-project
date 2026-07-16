/**
 * POST /api/stitches — create (enqueue) a stitched-stream job.
 *
 * Flow: resolve the user's followed-show episodes (PROFILE-GATED) → plan the
 * stitch → enqueue a `queued` job → return its id. Heavy processing happens
 * later in the worker (src/lib/concat/worker.ts), never in this request.
 *
 * Auth: TODO(auth) — once Clerk is wired, derive the user from the session
 * instead of the request body. Until then this route is guarded behind
 * DATABASE_URL being present and takes an explicit userId for local testing.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { planStitch } from "@/lib/concat";
import {
  getCandidateEpisodesForUser,
  enqueueStitch,
} from "@/lib/concat/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // TODO(auth): replace with the authenticated Clerk user's app id.
  userId: z.string().uuid(),
  title: z.string().max(200).optional(),
  targetDurationSec: z.number().int().positive().optional(),
  order: z.enum(["newest", "oldest"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { userId, title, targetDurationSec, order } = parsed.data;

  // PROFILE GATE: only episodes from shows this user follows are eligible.
  const candidates = await getCandidateEpisodesForUser(userId);
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "No episodes available from followed shows." },
      { status: 400 },
    );
  }

  const plan = planStitch(candidates, { targetDurationSec, order });
  if (plan.segments.length === 0) {
    return NextResponse.json(
      { error: "Could not build a plan (episodes lack durations?)." },
      { status: 400 },
    );
  }

  const stitchId = await enqueueStitch(userId, plan, title);
  return NextResponse.json(
    {
      stitchId,
      status: "queued",
      segmentCount: plan.segments.length,
      estimatedDurationSec: plan.estimatedDurationSec,
    },
    { status: 201 },
  );
}
