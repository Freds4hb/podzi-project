/**
 * Storage factory — chooses the concrete StorageClient from the environment.
 *
 * If S3/R2 credentials are present, use S3Storage (production). Otherwise fall
 * back to LocalStorage under `.storage/` so the pipeline runs in local dev/CI
 * with no cloud credentials.
 */
import { env } from "@/lib/env";
import type { StorageClient } from "./types";
import { S3Storage } from "./s3";
import { LocalStorage } from "./local";

export * from "./types";
export { S3Storage } from "./s3";
export { LocalStorage } from "./local";

/** True when all S3/R2 credentials are configured. */
export function isS3Configured(): boolean {
  return Boolean(
    env.AUDIO_STORAGE_ENDPOINT &&
      env.AUDIO_STORAGE_BUCKET &&
      env.AUDIO_STORAGE_ACCESS_KEY_ID &&
      env.AUDIO_STORAGE_SECRET_ACCESS_KEY,
  );
}

export function getStorage(): StorageClient {
  if (isS3Configured()) {
    return new S3Storage({
      endpoint: env.AUDIO_STORAGE_ENDPOINT,
      bucket: env.AUDIO_STORAGE_BUCKET,
      accessKeyId: env.AUDIO_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.AUDIO_STORAGE_SECRET_ACCESS_KEY,
      region: env.AUDIO_STORAGE_REGION || "auto",
      // Fall back to the endpoint if no dedicated public/CDN base is set.
      publicBaseUrl:
        env.AUDIO_STORAGE_PUBLIC_URL ||
        `${env.AUDIO_STORAGE_ENDPOINT}/${env.AUDIO_STORAGE_BUCKET}`,
    });
  }
  return new LocalStorage({
    baseDir: ".storage",
    publicBaseUrl: `${env.NEXT_PUBLIC_APP_URL}/_storage`,
  });
}
