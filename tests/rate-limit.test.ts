import { describe, expect, it } from "vitest";
import { clientKey, createLimiter } from "@/lib/rate-limit";
import { MessageSchema } from "@/lib/schema";

describe("createLimiter", () => {
  it("allows up to the limit per key, then says how long to wait", () => {
    let t = 0;
    const l = createLimiter(2, 60_000, () => t);
    expect(l.check("a").ok).toBe(true);
    expect(l.check("a").ok).toBe(true);
    expect(l.check("b").ok).toBe(true);
    t = 15_000;
    expect(l.check("a")).toEqual({ ok: false, retryAfterSeconds: 45 });
    t = 60_001;
    expect(l.check("a").ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("input limits", () => {
  it("rejects oversized message fields", () => {
    expect(MessageSchema.safeParse({ id: "a", body: "x".repeat(20_001) }).success).toBe(false);
    expect(MessageSchema.safeParse({ id: "a", body: "x", subject: "s".repeat(501) }).success).toBe(false);
    expect(MessageSchema.safeParse({ id: "a", body: "x".repeat(20_000) }).success).toBe(true);
  });
});
