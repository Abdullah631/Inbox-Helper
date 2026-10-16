// Calls from the browser to our own API. Every response is checked against the shared
// schemas: on Day 5 the review found that a Vercel timeout page (HTML, status 504) made
// the old code show "Unexpected token '<'" instead of a useful message.
import type { z } from "zod";
import { ConfigResponseSchema } from "../schema";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError("Couldn't reach the server. Check your connection and try again.");
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) {
    throw new ApiError(
      res.status === 504
        ? "The server took too long to answer. Try fewer messages, or Keywords mode."
        : `The server answered with an error (HTTP ${res.status}).`,
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = (data ?? {}) as { error?: unknown; issues?: unknown };
    const issues = Array.isArray(body.issues) ? body.issues.filter((i): i is string => typeof i === "string") : [];
    throw new ApiError([typeof body.error === "string" ? body.error : `HTTP ${res.status}`, ...issues].join(" "));
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError("The server sent a response this page doesn't understand. Reload and try again.");
  return parsed.data;
}

export function postJson<T>(url: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  return request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }, schema);
}

export function getConfig(signal?: AbortSignal) {
  return request("/api/config", { signal, cache: "no-store" }, ConfigResponseSchema);
}

export { isAbort };
