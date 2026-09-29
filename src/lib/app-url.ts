import "server-only";
import { headers } from "next/headers";
import { getEnv } from "@/lib/env";

/** Public base URL (no trailing slash): APP_URL, else derived from the request's host headers. */
export async function getAppUrl(): Promise<string> {
  const configured = getEnv().APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Where the Shortcut POSTs its data. */
export async function getIngestUrl(): Promise<string> {
  return `${await getAppUrl()}/api/ingest`;
}
