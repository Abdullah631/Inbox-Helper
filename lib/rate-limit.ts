// Per-IP limit on AI requests. The API is public (anyone with the URL can call it),
// and every call spends the shared free-tier token budget. Found on Day 4 when the
// daily Groq limit ran out and the live site dropped to keywords.
//
// This lives in memory, so it only counts requests that hit the same serverless
// instance. It stops a single script hammering the site; it is not a real firewall.
// For that, add a rate-limit rule in Vercel's Firewall settings.

export type Limiter = { check: (key: string) => { ok: boolean; retryAfterSeconds: number } };

export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now): Limiter {
  const hits = new Map<string, number[]>();
  return {
    check(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + windowMs - t) / 1000) };
      }
      recent.push(t);
      hits.set(key, recent);
      // Keep memory bounded if many IPs show up.
      if (hits.size > 5000) hits.delete(hits.keys().next().value!);
      return { ok: true, retryAfterSeconds: 0 };
    },
  };
}

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "unknown";
}

// One inbox of 60 messages makes 3 classify calls and 6 draft calls, so 30 a minute
// leaves room for a couple of real runs and not much more.
export const aiLimiter = createLimiter(30, 60_000);
