/**
 * The mobile app's single API client instance.
 *
 * Mobile differs from web in exactly one respect: it is not served from the
 * API's origin, so it needs an absolute base URL. Everything else — the request
 * shapes, the response types, the error semantics — comes from the shared
 * `@podzi/api-client` package that the web app also imports.
 *
 * The base URL is read from Expo config (`extra.apiBaseUrl` in app.json), which
 * can be overridden per build without touching code. `localhost` works in the
 * iOS simulator; a physical device needs the host machine's LAN address or a
 * deployed URL.
 */
import Constants from "expo-constants";
import { createPodziClient } from "@podzi/api-client";

/** Resolve the API base URL from Expo config, falling back to local dev. */
export function getApiBaseUrl(): string {
  const configured = (
    Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined
  )?.apiBaseUrl;
  return configured?.replace(/\/$/, "") || "http://localhost:3000";
}

export const api = createPodziClient({ baseUrl: getApiBaseUrl() });
