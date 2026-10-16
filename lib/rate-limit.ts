// Per-client limits on the API. The API is public, and every AI call spends the
// shared free-tier token budget. Limits are counted in messages, not requests, so one
// big request costs what it actually spends (Day 5 security review).
//
// This lives in memory, so it only counts requests that reach the same serverless
// instance. It slows down a single script; it is not a firewall. For real protection
// add a rate-limit rule for /api/* in Vercel's Firewall settings.

export type LimitResult = { ok: boolean; retryAfterSeconds: number };
export type Limiter = { check: (key: string, cost?: number) => LimitResult };

const MAX_KEYS = 5_000;

export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now): Limiter {
  const hits = new Map<string, { t: number; cost: number }[]>();
  return {
    check(key, cost = 1) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((h) => t - h.t < windowMs);
      const used = recent.reduce((sum, h) => sum + h.cost, 0);

      // Re-inserting moves the key to the end, so the oldest-used key is evicted first.
      hits.delete(key);
      if (used + cost > limit) {
        hits.set(key, recent);
        const oldest = recent[0]?.t ?? t;
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)) };
      }
      recent.push({ t, cost });
      hits.set(key, recent);
      if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
      return { ok: true, retryAfterSeconds: 0 };
    },
  };
}

// The client's address. On Vercel, x-vercel-forwarded-for and x-real-ip are set by the
// platform and can't be forged by the caller; the first x-forwarded-for entry is only a
// fallback for other hosts. IPv6 is keyed by its /64, since one machine usually owns
// a whole /64 and could otherwise rotate addresses to dodge the limit.
export function clientKey(headers: Headers): string {
  const ip =
    headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown";
  if (!ip.includes(":")) return ip;
  const groups = ip.split("::")[0].split(":").slice(0, 4);
  return `${groups.join(":")}::/64`;
}
