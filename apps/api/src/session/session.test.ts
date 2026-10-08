import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rateLimit.js";
import { csrfTokenFor, hashToken, newSessionToken, safeEqual } from "./tokens.js";

describe("tokens", () => {
  it("creates unique, long tokens and hashes deterministically", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });

  it("binds the CSRF token to both the session and the secret", () => {
    const h = hashToken("x");
    expect(csrfTokenFor("secret-one", h)).toBe(csrfTokenFor("secret-one", h));
    expect(csrfTokenFor("secret-one", h)).not.toBe(csrfTokenFor("secret-two", h));
    expect(csrfTokenFor("secret-one", h)).not.toBe(csrfTokenFor("secret-one", hashToken("y")));
  });

  it("compares secrets safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("ab", "abc")).toBe(false);
    expect(safeEqual(undefined, "abc")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit within the window, then blocks, then recovers", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(false);
    expect(limiter.allow("other")).toBe(true);
    now = 1001;
    expect(limiter.allow("ip")).toBe(true);
  });
});
