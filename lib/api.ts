import { NextResponse } from "next/server";
import type { z } from "zod";
import { NoProviderError } from "./classify";
import { REQUEST_LIMITS } from "./limits";
import { createLimiter, clientKey, type Limiter } from "./rate-limit";
import { serverConfig } from "./server-config";

// Everything the two POST routes have in common, so each route is only its own logic.
// Checks run cheapest first, and nothing is parsed or spent before the request is
// known to be same-origin, JSON, small enough and within its rate limit.

let limiters: { ai: Limiter; keyword: Limiter } | undefined;
function getLimiters() {
  const c = serverConfig();
  limiters ??= {
    ai: createLimiter(c.AI_RATE_LIMIT_PER_MIN, 60_000),
    keyword: createLimiter(c.KEYWORD_RATE_LIMIT_PER_MIN, 60_000),
  };
  return limiters;
}

// Only for tests.
export function resetLimitersForTests() {
  limiters = undefined;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export const errorResponse = (status: number, error: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  json({ error, ...extra }, status, headers);

// Browsers attach Origin to every cross-site POST. Without this check, any website
// could make its visitors' browsers spend this app's tokens (Day 5 security review,
// confirmed against the live site). Calls without Origin (curl, scripts) are allowed:
// they aren't using a victim's browser, and the rate limit still applies.
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (!origin) return fetchSite !== "cross-site";

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && originHost === host) return true;
  const extra = serverConfig().ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  return extra.includes(origin);
}

type Handler<T> = {
  schema: z.ZodType<T>;
  // Which limiter and how many units this request costs.
  cost: (data: T) => { kind: "ai" | "keyword"; units: number };
  run: (data: T, signal: AbortSignal) => Promise<unknown>;
};

export async function handleJsonPost<T>(req: Request, handler: Handler<T>): Promise<Response> {
  if (!isAllowedOrigin(req)) return errorResponse(403, "Requests from other sites aren't allowed.");

  // Requiring application/json also makes browsers send a CORS preflight, which this
  // API never answers, so a cross-site page can't even send the request.
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) return errorResponse(415, "Send the request as application/json.");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > REQUEST_LIMITS.bodyBytesMax) return errorResponse(413, "Request body is too large.");
  const raw = await req.text();
  if (Buffer.byteLength(raw) > REQUEST_LIMITS.bodyBytesMax) return errorResponse(413, "Request body is too large.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "Request body must be JSON.");
  }

  const parsed = handler.schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    return errorResponse(400, "Invalid request.", { issues });
  }

  const { kind, units } = handler.cost(parsed.data);
  const limit = getLimiters()[kind].check(clientKey(req.headers), units);
  if (!limit.ok) {
    const hint = kind === "ai" ? " or switch to Keywords" : "";
    return errorResponse(
      429,
      `Too many requests from your address. Wait ${limit.retryAfterSeconds}s${hint}.`,
      {},
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

  // Model calls stop when the budget runs out or the browser goes away, so the route
  // answers before Vercel's 60s limit instead of being killed with a 504.
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(serverConfig().REQUEST_BUDGET_MS)]);
  try {
    return json(await handler.run(parsed.data, signal));
  } catch (e) {
    if (e instanceof NoProviderError) return errorResponse(400, e.message);
    // Log the kind of failure only. Messages and drafts are candidate data.
    console.error(`[api] ${new URL(req.url).pathname} failed: ${e instanceof Error ? e.name : typeof e}`);
    return errorResponse(500, "Something went wrong on the server. Try Keywords mode.");
  }
}
