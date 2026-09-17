/**
 * S3-compatible storage — the production implementation of StorageClient.
 *
 * Works with Cloudflare R2 (recommended: zero egress at scale), AWS S3, MinIO,
 * etc. Uses path-style addressing and a configurable endpoint. The public URL
 * is built from a separate CDN/public base so objects are served through the
 * zero-egress edge, not the API endpoint.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageClient, StoredObject } from "./types";

export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 uses "auto"; S3 uses a real region. */
  region?: string;
  /** Public/CDN base URL objects are served from. */
  publicBaseUrl: string;
}

export class S3Storage implements StorageClient {
  readonly name = "s3";
  private readonly client: S3Client;

  constructor(private readonly cfg: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region || "auto",
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    const base = this.cfg.publicBaseUrl.replace(/\/$/, "");
    return { key, url: `${base}/${key}`, bytes: body.length };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      if (!res.Body) return null;
      // `transformToByteArray` is available on the SDK v3 stream wrapper.
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      // A missing key surfaces as NoSuchKey/404 — treat as absent, not fatal.
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
  return (
    name?.name === "NoSuchKey" ||
    name?.name === "NotFound" ||
    name?.$metadata?.httpStatusCode === 404
  );
}
