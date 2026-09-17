/**
 * Local filesystem storage — the dev/CI implementation of StorageClient.
 *
 * Writes objects under a base directory and returns app-relative URLs. Not for
 * production (no CDN, not shared across instances); production uses S3Storage.
 * Kept free of env/DB imports so it is directly testable.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { StorageClient, StoredObject } from "./types";

export interface LocalStorageConfig {
  /** Directory on disk to write objects into. */
  baseDir: string;
  /** Public base URL objects are served from (e.g. "/_storage"). */
  publicBaseUrl: string;
}

export class LocalStorage implements StorageClient {
  readonly name = "local";
  constructor(private readonly cfg: LocalStorageConfig) {}

  async put(
    key: string,
    body: Buffer | Uint8Array,
    _contentType: string,
  ): Promise<StoredObject> {
    const dest = path.join(this.cfg.baseDir, key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, body);
    const base = this.cfg.publicBaseUrl.replace(/\/$/, "");
    return {
      key,
      url: `${base}/${key}`,
      bytes: body.length,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(path.join(this.cfg.baseDir, key));
    } catch {
      return null; // treat missing/unreadable as absent
    }
  }
}
