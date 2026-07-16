/**
 * Dev worker runner: process a single queued stitch by id.
 *
 *   npx tsx scripts/process-stitch.mts <stitchId>
 *
 * In production a queue consumer calls `processStitch` off the request path;
 * this script is the local equivalent. Requires DATABASE_URL (and, for real
 * transcripts/summaries, the provider keys) in the environment.
 */
import { processStitch } from "../src/lib/concat/worker.ts";

const stitchId = process.argv[2];
if (!stitchId) {
  console.error("Usage: tsx scripts/process-stitch.mts <stitchId>");
  process.exit(1);
}

const result = await processStitch(stitchId);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "ready" ? 0 : 1);
