/**
 * Object storage abstraction for stitched audio + cached transcripts.
 *
 * The pipeline depends only on this interface, so we can run against the local
 * filesystem in dev/CI and against Cloudflare R2 (or any S3-compatible,
 * zero-egress store) in production without touching pipeline code.
 */
export interface StoredObject {
  key: string;
  /** Publicly reachable URL (CDN in production, app route in local dev). */
  url: string;
  bytes: number;
}

export interface StorageClient {
  /** Short name for logs / admin display (e.g. "s3", "local"). */
  readonly name: string;
  /** Upload bytes under `key` and return its public URL. */
  put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<StoredObject>;
  /**
   * Read bytes previously stored under `key`, or null if absent. Used by the
   * transcribe-once cache to reuse a transcript instead of re-transcribing.
   */
  get(key: string): Promise<Buffer | null>;
}
